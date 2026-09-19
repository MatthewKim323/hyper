import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('pool',Path(__file__).with_name('run.py'))
pool=importlib.util.module_from_spec(spec); spec.loader.exec_module(pool)

class FakeProcess:
    calls=0
    def __init__(self,cmd,stdin,text,stdout,stderr,start_new_session):
        self.cmd,self.stdout=cmd,stdout; self.pid=123; self.returncode=0
        FakeProcess.calls+=1
    def communicate(self,prompt,timeout):
        packet=json.loads(prompt.split('PACKET:\n')[1])
        result={'packet_id':packet['packet_id'],'documents':[{'document_id':packet['packet_id']+f'-doc-{i}','kind':'email','date':packet['date'],'subject':'Review','body':' '.join(['Evidence']*60),'source_refs':['INV-1']} for i in range(1,7)]}
        Path(self.cmd[self.cmd.index('-o')+1]).write_text(json.dumps(result))
        self.stdout.write(json.dumps({'type':'thread.started','thread_id':'test-session'})+'\n')
        self.stdout.write(json.dumps({'type':'turn.completed','usage':{'input_tokens':100,'output_tokens':50}})+'\n')

class PoolTests(unittest.TestCase):
    def test_isolated_workspaces_and_resume(self):
        with tempfile.TemporaryDirectory() as d,patch.object(pool.subprocess,'Popen',FakeProcess):
            root=Path(d); out=root/'out'; out.mkdir(); work=root/'runs'; work.mkdir()
            FakeProcess.calls=0
            for n in ('001','002'):
                packet={'packet_id':'packet-'+n,'date':'2025-01-31','immutable_facts':{'invoice_id':'INV-1'}}
                result=pool.run_one(packet,out,work)
                self.assertEqual(result['status'],'completed')
                self.assertTrue((work/packet['packet_id']/'workspace/packet.json').exists())
                self.assertEqual(pool.run_one(packet,out,work)['status'],'completed')
            self.assertEqual(FakeProcess.calls,2)
            self.assertEqual(len(list(out.glob('*.json'))),2)
    def test_reference_and_date_rejected(self):
        packet={'packet_id':'packet-001','date':'2025-01-31','invoice_id':'INV-1'}
        doc={'document_id':'one','body':' '.join(['x']*60),'source_refs':['INV-FAKE'],'date':'2025-01-31'}
        result={'packet_id':'packet-001','documents':[dict(doc,document_id=str(i)) for i in range(6)]}
        with self.assertRaises(AssertionError): pool.check(result,packet)
        for d in result['documents']: d.update(source_refs=['INV-1'],date='2026-01-01')
        with self.assertRaises(AssertionError): pool.check(result,packet)

if __name__=='__main__': unittest.main()
