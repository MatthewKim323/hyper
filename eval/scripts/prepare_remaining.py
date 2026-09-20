"""Download pinned public inputs; separate gold before packaging worker workspaces."""
import concurrent.futures,json,hashlib,zipfile
from pathlib import Path
import httpx
ROOT=Path(__file__).resolve().parents[1]/'runs/remaining-20260919'
REV={'dabstep':'be54e258883ea46d6625d15a213838f4462c8b3b','apex':'bf5e8c99117b7ee763d79ad2c64563ac844d77d2'}
def get(url,path):
 path.parent.mkdir(parents=True,exist_ok=True)
 if path.exists():return
 r=httpx.get(url,follow_redirects=True,timeout=120);r.raise_for_status();path.write_bytes(r.content)
def main():
 jobs=[]
 for name in ['acquirer_countries.csv','fees.json','manual.md','merchant_category_codes.csv','merchant_data.json','payments-readme.md','payments.csv']:
  jobs.append((f'https://huggingface.co/datasets/adyen/DABstep/resolve/{REV["dabstep"]}/data/context/{name}',ROOT/'dabstep/workspace/context'/name))
 jobs.append((f'https://huggingface.co/datasets/adyen/DABstep/resolve/{REV["dabstep"]}/data/tasks/dev.jsonl',ROOT/'dabstep/private/dev.jsonl'))
 jobs.append(('https://huggingface.co/spaces/adyen/DABstep/resolve/d4431c2e4a695cbe43c33aab2adaa304a37ae64a/dabstep_benchmark/evaluation/scorer.py',ROOT/'dabstep/private/scorer.py'))
 jobs.append((f'https://huggingface.co/datasets/mercor/apex-accounting/resolve/{REV["apex"]}/data/dev.jsonl',ROOT/'apex/private/dev.jsonl'))
 tree=json.loads((ROOT/'apex-accounting-tree.json').read_text())
 for row in tree:
  name=row['path']
  if row['type']=='file' and name.startswith(('world/','task_files/')):
   jobs.append((f'https://huggingface.co/datasets/mercor/apex-accounting/resolve/{REV["apex"]}/{name}',ROOT/'apex/workspace'/name))
 for suffix in ['eval','solution']:
  name=f'BenchRec_cash_v1.0_{suffix}.csv'
  jobs.append((f'https://www.kaggle.com/api/v1/datasets/download/benchmarkteam/benchrec-real-world-cash-reconciliation-dataset/{name}?datasetVersionNumber=3',ROOT/'benchrec'/('workspace' if suffix=='eval' else 'private')/name))
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  for future in [pool.submit(get,*job) for job in jobs]:future.result()
 for name in ['dabstep','apex']:
  rows=[json.loads(x) for x in (ROOT/name/'private/dev.jsonl').read_text().splitlines()]
  visible=[{k:r[k] for k in ('task_id','question','guidelines','level') if k in r} if name=='dabstep' else {'task_id':r['task_id'],'prompt':r['prompt']} for r in rows]
  (ROOT/name/'workspace/tasks.json').write_text(json.dumps(visible,indent=2))
 for name in ['benchrec','dabstep','apex']:
  workspace=ROOT/name/'workspace'
  with zipfile.ZipFile(ROOT/name/'inputs.zip','w',zipfile.ZIP_DEFLATED) as z:
   for p in sorted(workspace.rglob('*')):
    if p.is_file():z.write(p,'workspace/'+str(p.relative_to(workspace)))
  manifest={'benchmark':name,'revision':REV.get(name,'Kaggle version 3'),'input_sha256':hashlib.sha256((ROOT/name/'inputs.zip').read_bytes()).hexdigest(),'input_files':[str(p.relative_to(workspace)) for p in workspace.rglob('*') if p.is_file()],'system_kind':'WORKER_BASELINE','trial':1,'private_answers_uploaded':False}
  (ROOT/name/'pilot-manifest.json').write_text(json.dumps(manifest,indent=2))
  print(name,'prepared',len(manifest['input_files']),'files, zip bytes',(ROOT/name/'inputs.zip').stat().st_size)
if __name__=='__main__':main()
