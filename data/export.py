#!/usr/bin/env python3
"""Build a fresh explicit allowlist bundle; never export generator truth or logs."""
import argparse, hashlib, json, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def export(destination,include_drafts=False):
    destination=Path(destination).resolve()
    if destination.exists(): raise ValueError('Export destination must not exist; choose a fresh path')
    destination.mkdir(parents=True)
    source=ROOT/'generated/visible'
    if not source.is_dir(): raise ValueError('Generate visible data first')
    for item in source.rglob('*'):
        if item.is_symlink(): raise ValueError(f'Symlink rejected: {item}')
        if item.is_file():
            target=destination/'records'/item.relative_to(source)
            target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(item,target)
    if include_drafts:
        for item in (ROOT/'generated/narratives').glob('packet-*.json'):
            record=json.loads(item.read_text())
            assert record['synthetic'] is True
            target=destination/'synthetic_drafts'/item.name
            target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(item,target)
    manifest={'synthetic':True,'contains_generator_truth':False,'contains_unreviewed_narrative_drafts':include_drafts,'files':[]}
    for f in sorted(destination.rglob('*')):
        if f.is_file(): manifest['files'].append({'path':str(f.relative_to(destination)),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()})
    (destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'destination':str(destination),'files':len(manifest['files'])}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('destination');p.add_argument('--include-drafts',action='store_true');a=p.parse_args();export(a.destination,a.include_drafts)
