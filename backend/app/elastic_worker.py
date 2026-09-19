"""Run with python -m app.elastic_worker; dispatches bounded Elastic Workflows."""
import argparse
import logging
import time
from pathlib import Path
from dotenv import load_dotenv
from .store import Store
from .elastic_investigations import run_once


def main():
    load_dotenv(Path(__file__).resolve().parents[1]/'.env')
    parser=argparse.ArgumentParser();parser.add_argument('--once',action='store_true');args=parser.parse_args()
    store=Store()
    while True:
        try: worked=run_once(store)
        except Exception as exc:
            logging.warning('Elastic worker unavailable (%s)',type(exc).__name__)
            worked=False
        if args.once:break
        if not worked:time.sleep(5)

if __name__=='__main__':main()
