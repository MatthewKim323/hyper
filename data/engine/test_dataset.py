import copy,json,tempfile,unittest
from pathlib import Path
from generate import generate
from validate import validate
from fixtures import build

class DatasetTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory();cls.root=Path(cls.temp.name)/'data';generate(cls.root);build(cls.root)
 @classmethod
 def tearDownClass(cls):cls.temp.cleanup()
 def corrupt(self,table,mutator):
  path=self.root/'visible'/f'{table}.jsonl';old=path.read_text();rows=[json.loads(x) for x in old.splitlines()];mutator(rows);path.write_text(''.join(json.dumps(x)+'\n' for x in rows))
  try:self.assertFalse(validate(self.root)['valid'])
  finally:path.write_text(old)
 def test_all_financial_ties(self):self.assertTrue(validate(self.root)['valid'])
 def test_unbalanced_journal(self):self.corrupt('journal_lines',lambda r:r[0].update(debit_cents=r[0]['debit_cents']+1))
 def test_duplicate_credit_allocation(self):self.corrupt('credit_allocations',lambda r:r.append(dict(r[0])))
 def test_changed_bank_statement(self):self.corrupt('settlement_movements',lambda r:r[0].update(amount_cents=r[0]['amount_cents']-100))
 def test_false_monthly_statement(self):self.corrupt('statements',lambda r:r[0]['balance_sheet'].update(assets_cents=1))
 def test_false_deferred_revenue_schedule(self):self.corrupt('revenue_schedule',lambda r:r[0].update(amount_cents=1))
 def test_false_payroll_remittance(self):self.corrupt('payroll_remittances',lambda r:r[0].update(amount_cents=1))
 def test_wrong_settlement_source(self):self.corrupt('settlement_movements',lambda r:r[0].update(source_id='WRONG'))
 def test_missing_month(self):self.corrupt('statements',lambda r:r.pop())
 def test_duplicate_month(self):self.corrupt('statements',lambda r:r.append(dict(r[-1])))
 def test_shifted_receipt_date(self):self.corrupt('ar_receipts',lambda r:r[0].update(date='2025-01-22'))
 def test_duplicate_import_is_same_economic_invoice(self):
  case=json.loads((self.root/'visible/cases/CASE-010.json').read_text());docs=[d for d in case['documents'] if d['type']=='invoice'];self.assertEqual(len(docs),2);self.assertNotEqual(docs[0]['document_id'],docs[1]['document_id']);self.assertEqual(docs[0]['body']['invoice_id'],docs[1]['body']['invoice_id']);self.assertEqual(docs[0]['sha256'],docs[1]['sha256'])
 def test_early_payment_allocation(self):self.corrupt('ar_allocations',lambda r:r[0].update(date='2024-01-01'))
 def test_missing_journal_source(self):self.corrupt('journals',lambda r:r[0].update(source_id='MISSING'))
 def test_fixture_evidence_math(self):
  for path in (self.root/'private/cases').glob('*.json'):
   hidden=json.loads(path.read_text());visible=json.loads((self.root/'visible/cases'/path.name).read_text())
   self.assertNotIn('expected_disposition',visible);self.assertNotIn('development_family',visible)
   self.assertFalse(any(d['type']=='credit_memo' for d in visible['documents']))
   self.assertEqual(visible['bank_effect_cents'],0)
   if hidden['expected_net_cents'] is None:continue
   iid=visible['invoice_id'];invoice=next(d['body'] for d in visible['documents'] if d['type']=='invoice')
   credits={x['document']['document_id']:x['document']['body'] for x in hidden['counterparty_events'] if x['document']['type']=='credit_memo' and x['document']['body']['invoice_id']==iid}
   self.assertEqual(invoice['amount_cents']-sum(c['amount_cents'] for c in credits.values()),hidden['expected_net_cents'])
 def test_hero_partial_response(self):
  hidden=json.loads((self.root/'private/cases/CASE-001.json').read_text());case=json.loads((self.root/'visible/cases/CASE-001.json').read_text());face=case['documents'][0]['body']['amount_cents'];credits=[x['document']['body']['amount_cents'] for x in hidden['counterparty_events'] if x['document']['type']=='credit_memo']
  self.assertEqual(face,12000000);self.assertEqual(credits,[2000000,2000000]);self.assertNotEqual(face-credits[0],hidden['expected_net_cents']);self.assertEqual(face-sum(credits),8000000)
 def test_reproducibility(self):
  with tempfile.TemporaryDirectory() as d:
   other=Path(d)/'dataset';generate(other)
   self.assertEqual((other/'visible/journal_lines.jsonl').read_bytes(),(self.root/'visible/journal_lines.jsonl').read_bytes())
   self.assertEqual((other/'private/narrative_packets.jsonl').read_bytes(),(self.root/'private/narrative_packets.jsonl').read_bytes())
if __name__=='__main__':unittest.main()
