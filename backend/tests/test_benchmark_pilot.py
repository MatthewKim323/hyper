import importlib.util
from pathlib import Path
import pytest

path=Path(__file__).resolve().parents[2]/'eval/scripts/invoice_devin.py'
spec=importlib.util.spec_from_file_location('invoice_pilot',path)
pilot=importlib.util.module_from_spec(spec);spec.loader.exec_module(pilot)


def test_repeated_launch_is_refused(tmp_path):
    pilot.write(tmp_path/'launch.json',{'state':'creation_pending'})
    with pytest.raises(ValueError,match='already attempted'):pilot.start(tmp_path)


def test_changed_archive_is_refused(tmp_path):
    (tmp_path/'inputs.zip').write_bytes(b'changed')
    pilot.write(tmp_path/'pilot-manifest.json',{'input_sha256':'original'})
    with pytest.raises(ValueError,match='changed'):pilot.start(tmp_path)


def test_incomplete_answer_never_scored(tmp_path,monkeypatch):
    pilot.write(tmp_path/'launch.json',{'state':'created','session_id':'test'})
    class Response:
        def raise_for_status(self):pass
        def json(self):return {'status':'running','structured_output':{'complete':False,'submission_csv':'customer_id,net_spend_usd\na,1'}}
    class Client:
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def get(self,*args):return Response()
    monkeypatch.setattr(pilot,'client',Client)
    pilot.collect(tmp_path)
    assert not (tmp_path/'submission.csv').exists()
    assert not (tmp_path/'result.json').exists()


def test_visible_directories_exclude_grader():
    assert 'answer_key' not in pilot.PUBLIC_DIRS
    assert 'scripts' not in pilot.PUBLIC_DIRS
