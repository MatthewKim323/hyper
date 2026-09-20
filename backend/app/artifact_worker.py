import logging
import argparse
import time
from pathlib import Path
from dotenv import load_dotenv
from .store import Store
from .artifacts import run_once

def main():
    load_dotenv(Path(__file__).resolve().parents[1]/'.env')
    parser=argparse.ArgumentParser();parser.add_argument('--once',action='store_true');args=parser.parse_args()
    store=Store()
    while True:
        # A database blip must not kill the loop: the job-claim block inside run_once sits
        # outside its own handler, so a transient OperationalError would end the process
        # and leave queued work leased to nobody. Same guard as elastic_worker.
        try: worked=run_once(store)
        except Exception as exc:
            logging.warning('%s unavailable (%s)', 'artifact_worker', type(exc).__name__)
            worked=False
        if args.once:break
        if not worked:time.sleep(2)
if __name__=='__main__':main()
