"""Run continuously, or invoke --once from infrastructure cron."""
import argparse
import time
from pathlib import Path
from dotenv import load_dotenv
from .store import Store
from .simulator import run_once


def main():
    load_dotenv(Path(__file__).resolve().parents[1] / '.env')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--once', action='store_true', help='Process at most one due tick and exit')
    args = parser.parse_args()
    store = Store()
    while True:
        worked = run_once(store)
        if args.once:
            break
        if not worked:
            time.sleep(2)


if __name__ == '__main__':
    main()
