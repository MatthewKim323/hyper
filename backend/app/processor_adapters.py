"""Deterministic processor and bank statement adapters producing normalized settlement packets."""
import json
import time
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Literal
from pydantic import StrictBool
from sqlalchemy import select
from .data_service import StrictModel
from .settlements import Identifier, Batch, Movement, Statement, Deposit
from .accounting import Accounting
from .database import adapter_imports, sources, records, insert_ignore

class Drop(Exception):
    def __init__(self,reason):self.reason=reason

# Accepted field spellings per provider; the first present candidate wins.
STRIPE_ID_FIELDS=('id','balance_transaction','transaction_id')
STRIPE_TYPE_FIELDS=('type','transaction_type','category')
STRIPE_AMOUNT_FIELDS=('amount','amount_minor','net','net_amount')
STRIPE_PAYOUT_FIELDS=('payout_id','payout','payoutId','po_id')
ADYEN_ID_FIELDS=('pspReference','id','reference','merchantReference')
ADYEN_TYPE_FIELDS=('type','category','recordType','record_type')
ADYEN_PAYOUT_FIELDS=('payoutId','payout_id','payout','batchNumber','batch')
ADYEN_GROSS_FIELDS=('grossAmount','gross','amount','amount_minor')
ADYEN_NET_FIELDS=('netAmount','net')
ADYEN_FEE_FIELDS=('commission','markup','feeAmount','processingFee')
BANK_ID_FIELDS=('id','transaction_id','entry_id','bank_id')
BANK_REF_FIELDS=('reference','ref','bank_reference','payout_reference')
BANK_DATE_FIELDS=('booked_on','date','posted_at','booking_date','value_date')
BANK_AMOUNT_FIELDS=('amount_minor','amount')
CURRENCY_FIELDS=('currency','currency_code','Currency')

def norm(value):return str(value).strip().lower().replace(' ','_').replace('-','_')
KINDS={'charge':'sale','sale':'sale','payment':'sale','capture':'sale','settled':'sale',
    'platformpayment':'sale','platform_payment':'sale',
    'refund':'refund','refunded':'refund',
    'stripe_fee':'fee','fee':'fee','commission':'fee','markup':'fee',
    'processing_fee':'fee','processingfee':'fee','fee_amount':'fee',
    'chargeback':'chargeback','dispute':'chargeback','secondchargeback':'chargeback','second_chargeback':'chargeback',
    'chargeback_reversal':'chargeback_reversal','chargebackreversal':'chargeback_reversal',
    'chargeback_reversed':'chargeback_reversal','chargebackreversed':'chargeback_reversal',
    'reversed_chargeback':'chargeback_reversal',
    'reserve':'reserve_hold','reserve_hold':'reserve_hold','reservehold':'reserve_hold',
    'reserve_release':'reserve_release','reserverelease':'reserve_release'}
POSITIVE=('sale','chargeback_reversal','reserve_release')
NEGATIVE=('refund','fee','chargeback','reserve_hold')
ALL_KINDS=('sale','refund','fee','chargeback','chargeback_reversal','reserve_hold','reserve_release')

def first(row,names):
    for name in names:
        value=row.get(name)
        if value not in (None,''):return value
    return None

def text(value):
    if value is None or isinstance(value,(dict,list,bool)):return ''
    return str(value).strip()

def identifier(value):
    raw=text(value)
    if not raw:raise Drop('MISSING_ID')
    if len(raw)>200:raise Drop('INVALID_ID')
    return raw

def minor(value):
    """Minor units: integer values pass through; decimal majors convert only when exact to 2 places."""
    if value is None or isinstance(value,bool):raise Drop('INVALID_AMOUNT')
    try:amount=Decimal(str(value))
    except InvalidOperation:raise Drop('INVALID_AMOUNT')
    if not amount.is_finite() or amount<0:raise Drop('INVALID_AMOUNT')
    cents=amount if amount==amount.to_integral_value() else amount*100
    if cents!=cents.to_integral_value():raise Drop('NON_MINOR_AMOUNT')
    if cents>10**15:raise Drop('INVALID_AMOUNT')
    return int(cents)

def parse_date(value):
    if value in (None,''):raise Drop('MISSING_DATE')
    raw=str(value).strip()
    if raw.endswith('Z'):raw=raw[:-1]+'+00:00'
    for parser in (date.fromisoformat,lambda v:datetime.fromisoformat(v).date()):
        try:return parser(raw)
        except ValueError:pass
    try:
        return datetime.fromtimestamp(int(Decimal(raw)),tz=timezone.utc).date()
    except (InvalidOperation,ValueError,OverflowError,OSError):
        raise Drop('INVALID_DATE')

def row_currency(row,required=True):
    raw=text(first(row,CURRENCY_FIELDS))
    if not raw:
        if required:raise Drop('MISSING_CURRENCY')
        return None
    return raw.upper()

def payout_of(row,names):
    raw=text(first(row,names))
    if not raw:raise Drop('MISSING_PAYOUT')
    if len(raw)>200:raise Drop('INVALID_ID')
    return raw

def stripe_row(row):
    mid=identifier(first(row,STRIPE_ID_FIELDS))
    kind=KINDS.get(norm(first(row,STRIPE_TYPE_FIELDS) or ''))
    if kind is None:raise Drop('UNKNOWN_TYPE')
    amount=first(row,STRIPE_AMOUNT_FIELDS)
    if amount is None:raise Drop('MISSING_AMOUNT')
    currency=row_currency(row)
    return payout_of(row,STRIPE_PAYOUT_FIELDS),currency,[{'id':mid,'kind':kind,'amount_minor':minor(amount)}]

def adyen_row(row):
    mid=identifier(first(row,ADYEN_ID_FIELDS))
    kind=KINDS.get(norm(first(row,ADYEN_TYPE_FIELDS) or ''))
    if kind is None:raise Drop('UNKNOWN_TYPE')
    currency=row_currency(row)
    payout=payout_of(row,ADYEN_PAYOUT_FIELDS)
    gross=first(row,ADYEN_GROSS_FIELDS);net=first(row,ADYEN_NET_FIELDS)
    main=gross if gross is not None else net
    fees=[{'id':f'{mid}:{field}','kind':'fee','amount_minor':minor(row[field])}
          for field in ADYEN_FEE_FIELDS if row.get(field) not in (None,'')]
    head=[{'id':mid,'kind':kind,'amount_minor':minor(main)}] if main is not None else []
    movements=(fees or head) if kind=='fee' else head+fees
    if not movements:raise Drop('MISSING_AMOUNT')
    return payout,currency,movements

def bank_row(row):
    mid=text(first(row,BANK_ID_FIELDS));ref=text(first(row,BANK_REF_FIELDS))
    mid=mid or ref;ref=ref or mid
    if not mid:raise Drop('MISSING_ID')
    if len(mid)>200 or len(ref)>200:raise Drop('INVALID_ID')
    booked=parse_date(first(row,BANK_DATE_FIELDS))
    amount=first(row,BANK_AMOUNT_FIELDS)
    if amount is None:raise Drop('MISSING_AMOUNT')
    return row_currency(row,required=False),{'id':mid,'reference':ref,'booked_on':booked,'amount_minor':minor(amount)}

def processor_packet(body,rows):
    map_row={'stripe':stripe_row,'adyen':adyen_row}[body.provider]
    dropped=[];groups={};order=[]
    for row in rows:
        try:payout,currency,movements=map_row(row['payload'])
        except Drop as exc:
            dropped.append({'row_number':row['row_number'],'record_id':row['record_id'],'reason':exc.reason});continue
        if payout not in groups:groups[payout]=[];order.append(payout)
        groups[payout].append((row['row_number'],row['record_id'],currency,movements))
    candidates=order[:20]
    if body.payout_id:
        if body.payout_id not in groups:
            raise ValueError('Payout '+body.payout_id+' not found; candidates: '+(', '.join(candidates) or 'none'))
        selected=body.payout_id
    elif not groups:raise ValueError('No payout groups found in report')
    elif len(groups)>1:
        raise ValueError(f'Report contains {len(groups)} payouts; pass payout_id. Candidates: '+', '.join(candidates))
    else:selected=order[0]
    movements=[];seen=set();currencies=set()
    for payout in order:
        for number,record,currency,items in groups[payout]:
            if payout!=selected:
                dropped.append({'row_number':number,'record_id':record,'reason':'OTHER_PAYOUT'});continue
            kept=[m for m in items if m['id'] not in seen]
            if len(kept)!=len(items):
                dropped.append({'row_number':number,'record_id':record,'reason':'DUPLICATE_ID'})
            for m in kept:seen.add(m['id'])
            if kept:currencies.add(currency)
            movements.extend(kept)
    dropped.sort(key=lambda d:d['row_number'])
    if not movements:raise ValueError('No valid movements for payout '+selected)
    if len(currencies)>1:raise ValueError('Mixed currencies in payout '+selected)
    currency=next(iter(currencies))
    totals={kind:0 for kind in ALL_KINDS}
    for m in movements:totals[m['kind']]+=m['amount_minor']
    payout_minor=sum(totals[k] for k in POSITIVE)-sum(totals[k] for k in NEGATIVE)
    if payout_minor<0:raise ValueError('Net payout for '+selected+' is negative')
    batch=Batch(batch_id=selected,bank_account_id=body.bank_account_id,bank_reference=selected,
        currency=currency,expected_arrival=body.expected_arrival,complete=True,
        declared_count=len(movements),payout_minor=payout_minor,movements=[Movement(**m) for m in movements])
    return batch.model_dump(mode='json'),{'movement_count':len(movements),'dropped_rows':dropped,
        'payout_id':selected,'batch_id':batch.batch_id,'amounts_minor_by_kind':totals}

def bank_packet(body,rows,source_currency):
    if body.start>body.end:raise ValueError('Statement start must not be after end')
    dropped=[];deposits=[];seen=set();currencies=set()
    for row in rows:
        try:currency,deposit=bank_row(row['payload'])
        except Drop as exc:
            dropped.append({'row_number':row['row_number'],'record_id':row['record_id'],'reason':exc.reason});continue
        if not body.start<=deposit['booked_on']<=body.end:
            dropped.append({'row_number':row['row_number'],'record_id':row['record_id'],'reason':'OUTSIDE_PERIOD'});continue
        if deposit['id'] in seen:
            dropped.append({'row_number':row['row_number'],'record_id':row['record_id'],'reason':'DUPLICATE_ID'});continue
        seen.add(deposit['id'])
        if currency:currencies.add(currency)
        deposits.append(deposit)
    if not deposits:raise ValueError('No valid deposits inside the statement period')
    if len(currencies)>1:raise ValueError('Mixed currencies in bank statement')
    currency=next(iter(currencies)) if currencies else source_currency
    if not currency:raise ValueError('Statement currency unavailable')
    statement=Statement(bank_account_id=body.bank_account_id,currency=currency,start=body.start,end=body.end,
        complete=body.complete,deposits=[Deposit(**d) for d in deposits])
    return statement.model_dump(mode='json'),{'deposit_count':len(deposits),'dropped_rows':dropped,
        'bank_account_id':body.bank_account_id,'currency':currency}

class ImportProcessor(StrictModel):
    source_id: Identifier
    provider: Literal['stripe','adyen']
    payout_id: Identifier | None = None
    bank_account_id: Identifier
    expected_arrival: date
    request_key: Identifier

class ImportBankStatement(StrictModel):
    source_id: Identifier
    bank_account_id: Identifier
    start: date
    end: date
    complete: StrictBool
    request_key: Identifier

class ImportID(StrictModel):
    import_id: Identifier

TOOL_MODELS={'import_processor_report':ImportProcessor,'import_bank_statement':ImportBankStatement,'get_adapter_import':ImportID}
DESCRIPTIONS={
    'import_processor_report':'Normalize a stored Stripe or Adyen export into one exact settlement batch packet for a single payout. Maps minor-unit movements by kind, reports every unmappable row with row number and reason, and writes a normalized_packets source ID that reconcile_settlement accepts directly. Requires bank_account_id, expected_arrival and a stable request_key; pass payout_id when the report covers several payouts. Never invents rows, currencies or amounts.',
    'import_bank_statement':'Normalize a stored generic bank statement export into an exact statement packet bounded by start and end dates with a uniform currency. Rows outside the period or missing required fields are reported with reasons, never skipped silently. Writes a normalized_packets source for reconcile_settlement; requires a stable request_key.',
    'get_adapter_import':'Read a persisted adapter import including provider, input and output source IDs and dropped rows. Organization scoped; read only.',
}

class Adapters:
    def __init__(self,data):self.data,self.store,self.oid=data,data.store,data.oid
    def existing(self,db,key):
        return db.execute(select(adapter_imports).where(adapter_imports.c.organization_id==self.oid,
            adapter_imports.c.request_key==key)).mappings().first()
    def output(self,row):return {'import_id':row['id'],**row['result']}
    def get(self,import_id):
        with Accounting(self.store,self.oid).transaction() as db:
            row=db.execute(select(adapter_imports).where(adapter_imports.c.id==import_id,
                adapter_imports.c.organization_id==self.oid)).mappings().first()
        if not row:raise LookupError('Adapter import not found')
        return {'import_id':row['id'],'provider':row['provider'],'request_key':row['request_key'],
                'input_source_id':row['input_source_id'],'output_source_id':row['output_source_id'],
                'created_at':row['created_at'],'result':row['result']}
    def execute(self,name,args):
        body=TOOL_MODELS[name].model_validate(args)
        if name=='get_adapter_import':return self.get(body.import_id)
        provider=body.provider if name=='import_processor_report' else 'bank_statement'
        with Accounting(self.store,self.oid).transaction() as db:
            prior=self.existing(db,body.request_key)
            if prior:
                if prior['provider']!=provider or prior['input_source_id']!=body.source_id:
                    raise ValueError('request_key already used with different inputs')
                return self.output(prior)
            source=db.execute(select(sources).where(sources.c.id==body.source_id,
                sources.c.organization_id==self.oid,sources.c.active.is_(True))).mappings().first()
            if not source:raise LookupError('Active source not found')
            rows=db.execute(select(records.c.row_number,records.c.record_id,records.c.payload)
                .where(records.c.source_id==body.source_id,records.c.organization_id==self.oid)
                .order_by(records.c.row_number)).mappings().all()
            if not rows:raise ValueError('Source contains no records rows')
        if name=='import_processor_report':packet,result=processor_packet(body,rows)
        else:packet,result=bank_packet(body,rows,source['currency'])
        written=self.data.ingest(f'adapter-{provider}-{body.request_key}.json',
            json.dumps([{'id':body.request_key,'packet':packet}]).encode(),
            dataset='normalized_packets',source_key='adapter/'+body.request_key,id_field='id')
        result['output_source_id']=written['id']
        with Accounting(self.store,self.oid).transaction() as db:
            prior=self.existing(db,body.request_key)
            if prior:return self.output(prior)
            insert_ignore(db,adapter_imports,{'id':'imp_'+uuid.uuid4().hex,'organization_id':self.oid,
                'request_key':body.request_key,'provider':provider,'input_source_id':body.source_id,
                'output_source_id':written['id'],'result':result,'created_at':int(time.time()*1000)})
            return self.output(self.existing(db,body.request_key))
