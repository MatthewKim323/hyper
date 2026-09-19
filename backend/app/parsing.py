"""Deterministic import: no model-generated financial numbers."""
import csv
import io
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from pypdf import PdfReader

MAX_BYTES = 20 * 1024 * 1024
MAX_ROWS = 100000
MAX_CHUNKS = 100000
NAME = r'^[a-zA-Z_][a-zA-Z0-9_]{0,63}$'

def numeric(value):
    if isinstance(value,bool):
        raise ValueError('Boolean is not a financial number')
    try:
        n = Decimal(str(value))
    except InvalidOperation:
        raise ValueError('Invalid numeric value') from None
    if not n.is_finite() or n.adjusted() >= 26 or n.as_tuple().exponent < -12:
        raise ValueError('Numbers must fit NUMERIC(38,12)')
    return format(n,'f')

def parse_file(filename, body, dataset=None, field_types=None, id_field=None):
    if not body or len(body)>MAX_BYTES:
        raise ValueError('File must contain 1 byte to 20 MiB')
    ext = Path(filename).suffix.lower()
    field_types = field_types or {}
    if dataset:
        if not re.fullmatch(NAME,dataset):
            raise ValueError('Invalid dataset name')
        if ext not in ('.csv','.json','.jsonl'):
            raise ValueError('Financial datasets require CSV, JSON objects, or JSONL')
        text = body.decode('utf-8-sig')
        if ext == '.csv':
            reader = csv.DictReader(io.StringIO(text))
            if not reader.fieldnames or len(reader.fieldnames)!=len(set(reader.fieldnames)):
                raise ValueError('CSV requires unique column names')
            rows = list(reader)
            if any(None in r or None in r.values() for r in rows):
                raise ValueError('CSV rows must match the header')
        elif ext == '.jsonl':
            rows = [json.loads(line,parse_float=str) for line in text.splitlines() if line.strip()]
        else:
            rows = json.loads(text,parse_float=str)
            if isinstance(rows,dict):rows=[rows]
        if not isinstance(rows,list) or not 0<len(rows)<=MAX_ROWS or not all(isinstance(r,dict) for r in rows):
            raise ValueError('Expected 1–100000 financial records')
        fields = sorted({k for r in rows for k in r})
        if len(fields)>100 or any(not re.fullmatch(NAME,k) for k in fields):
            raise ValueError('At most 100 simple column names are supported')
        if set(field_types)-set(fields) or any(t not in ('text','numeric','date') for t in field_types.values()):
            raise ValueError('Schema must map existing columns to text, numeric, or date')
        schema = {}
        for field in fields:
            values = [r[field] for r in rows if r.get(field) not in (None,'')]
            inferred = 'text'
            if values and (all(isinstance(v,(int,float)) and not isinstance(v,bool) for v in values)
                           or field.endswith('_cents')):
                inferred = 'numeric'
            elif values and (field=='date' or field.endswith('_date')):
                inferred = 'date'
            schema[field] = field_types.get(field,inferred)
        if id_field and id_field not in fields:
            raise ValueError('id_field must exist in the dataset')
        if not id_field:
            # First source column usually contains its primary identifier. Never guess another table's foreign key.
            first = next(iter(rows[0]),'')
            if first=='id' or first.endswith('_id') or first=='account':
                id_field=first
        seen=set(); normalized=[]; evidence=[]
        for i,row in enumerate(rows,1):
            output={}
            for field,kind in schema.items():
                value=row.get(field)
                if value in (None,''):
                    output[field]=None
                elif kind=='numeric':
                    output[field]=numeric(value)
                elif kind=='date':
                    output[field]=date.fromisoformat(str(value)).isoformat()
                else:
                    output[field]=value if isinstance(value,(dict,list)) else str(value)
                if len(json.dumps(output[field]))>16000:
                    raise ValueError('A financial cell exceeds 16000 characters')
            rid=str(row.get(id_field,'')) if id_field else f'row-{i}'
            if not rid or rid in seen or len(rid)>256:
                raise ValueError('Record IDs must be nonempty and unique within a source')
            seen.add(rid)
            if len(json.dumps(output))>32000:
                raise ValueError('A financial row exceeds 32000 characters')
            normalized.append({'row_number':i,'record_id':rid,'payload':output})
            evidence.append({'locator':f'row:{i}', 'content':json.dumps(output,ensure_ascii=False)})
        return schema, normalized, evidence
    if ext=='.pdf':
        reader=PdfReader(io.BytesIO(body))
        if reader.is_encrypted:
            raise ValueError('Encrypted PDFs are not supported')
        if len(reader.pages)>500:
            raise ValueError('PDF exceeds 500 pages')
        sections=[(f'page:{i}',p.extract_text() or '') for i,p in enumerate(reader.pages,1)]
        if not any(t.strip() for _,t in sections):
            raise ValueError('No PDF text found; OCR scanned files before uploading')
    elif ext in ('.txt','.md','.json','.jsonl','.csv'):
        sections=[('text',body.decode('utf-8-sig'))]
    else:
        raise ValueError('Supported files: CSV, JSON, JSONL, TXT, Markdown, text PDFs')
    evidence=[]
    for locator,text in sections:
        # Overlap keeps local prose context; page/character locators remain stable.
        for start in range(0,len(text),1800):
            piece=text[start:start+2200]
            if piece.strip():
                evidence.append({'locator':f'{locator}:chars:{start}-{start+len(piece)}','content':piece})
            if len(evidence)>MAX_CHUNKS:
                raise ValueError('Document contains too many chunks')
    if not evidence:
        raise ValueError('No searchable content')
    return {},[],evidence
