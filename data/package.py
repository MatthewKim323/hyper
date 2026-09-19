#!/usr/bin/env python3
"""Create convenient SQLite + CSV projections and a complete checksum inventory."""
import csv,hashlib,json,sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'generated'
def package():
 visible=ROOT/'visible';db=visible/'company.sqlite'
 if db.exists():db.unlink()
 con=sqlite3.connect(db)
 schema={}
 for f in sorted(visible.glob('*.jsonl')):
  rows=[json.loads(x) for x in f.read_text().splitlines()]
  if not rows:continue
  keys=list(dict.fromkeys(k for row in rows for k in row));types={k:'INTEGER' if all(type(row.get(k)) in (int,type(None)) for row in rows) else 'TEXT' for k in keys};schema[f.stem]={'rows':len(rows),'fields':types}
  cols=','.join('"'+k+'" '+types[k] for k in keys);con.execute(f'CREATE TABLE "{f.stem}" ({cols})')
  def flatten(v):return json.dumps(v,separators=(',',':')) if isinstance(v,(dict,list,bool)) else v
  con.executemany(f'INSERT INTO "{f.stem}" VALUES ({",".join("?" for _ in keys)})',[[flatten(r.get(k)) for k in keys] for r in rows])
  if f.stem in ('statements','trial_balance','accounts','ap_invoices','ar_invoices','payroll','treasury_transfers'):
   folder=visible/'csv';folder.mkdir(exist_ok=True)
   with (folder/(f.stem+'.csv')).open('w',newline='') as out:
    writer=csv.DictWriter(out,fieldnames=keys);writer.writeheader();writer.writerows({k:flatten(row.get(k)) for k in keys} for row in rows)
 con.commit();assert con.execute('PRAGMA integrity_check').fetchone()[0]=='ok';con.close()
 (visible/'schema.json').write_text(json.dumps(schema,indent=2)+'\n')
 manifest={'synthetic':True,'seed':20260919,'tables':{k:v['rows'] for k,v in schema.items()},'canonical_table_rows':sum(x['rows'] for x in schema.values()),'narrative_packets_requested':102,'files':[]}
 for f in sorted(ROOT.rglob('*')):
  if f.is_file() and f!=ROOT/'manifest.json':manifest['files'].append({'path':str(f.relative_to(ROOT)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
 (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'canonical_table_rows':manifest['canonical_table_rows'],'files':len(manifest['files'])}))
if __name__=='__main__':package()
