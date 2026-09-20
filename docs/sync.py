#!/usr/bin/env python3
"""Regenerate the API reference from the backend's own markdown.

The docs are not a second copy to keep in step by hand: each page here is produced from
the file that ships next to the code. Run after changing any backend/*.md, and commit the
result. `python docs/sync.py --check` fails instead of writing, for CI.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parent

PAGES = {
    'api/onboarding': ('backend/API.md', 'Onboarding API', 'Voice and typed sessions, transcripts, and the readiness contract.'),
    'api/data': ('backend/DATA_API.md', 'Data API', 'Uploads, exact financial queries, evidence search and citations.'),
    'api/connectors': ('backend/CONNECTORS.md', 'Connectors', 'Read-only Gmail, Drive, Ramp and Plaid.'),
    'api/storage': ('backend/STORAGE.md', 'Storage', 'Postgres, S3-compatible objects and Elasticsearch.'),
    'api/accounting': ('backend/ACCOUNTING_API.md', 'Accounts payable', 'Deterministic AP analysis, proposals and approval.'),
    'api/posting': ('backend/POSTING_API.md', 'Journal posting', 'Drafts, the append-only ledger and reversals.'),
    'api/anomalies': ('backend/ANOMALY_API.md', 'Anomaly scanner', 'Evidence-backed outliers and escalation.'),
    'api/adapters': ('backend/ADAPTERS_API.md', 'Processor adapters', 'Processor reports and bank statements.'),
    'api/settlement': ('backend/SETTLEMENT_API.md', 'Settlements', 'Single-payout reconciliation.'),
    'api/accrual': ('backend/ACCRUAL_API.md', 'Accruals', 'Expense accruals and tracking.'),
    'api/agents': ('backend/DEVIN_API.md', 'Agent orchestration', 'Coordinator, workers and the tool bridge.'),
    'api/concerns': ('backend/CONCERNS_API.md', 'Concerns', 'Human decision cards.'),
    'api/artifacts': ('backend/ARTIFACTS_API.md', 'Artifacts', 'Generated financial charts and cards.'),
    'api/skills': ('backend/SKILLS_API.md', 'Learned skills', 'Versioned skill packages and runs.'),
    'api/world-agent': ('backend/WORLD_AGENT_API.md', 'World agent', 'The workspace CFO agent.'),
}


# Sibling markdown links resolve on GitHub but 404 once published, so rewrite the ones
# that have a page here and drop the link on the ones that do not ship (plans/ is internal).
LINKS = {src.rsplit('/', 1)[-1]: '/' + page for page, (src, _t, _d) in {}.items()}


def rewrite_links(body: str, pages: dict) -> str:
    known = {src.rsplit('/', 1)[-1]: '/' + page for page, (src, _t, _d) in pages.items()}

    def swap(match):
        text, target = match.group(1), match.group(2)
        name = target.rsplit('/', 1)[-1]
        if target.startswith(('http://', 'https://', '#', '/')):
            return match.group(0)
        if name in known:
            return f'[{text}]({known[name]})'
        # Internal-only documents (plans/, notes) have no published page: keep the prose,
        # lose the link, rather than publish a 404.
        return text

    return re.sub(r'\[([^\]]+)\]\(([^)]+\.md)\)', swap, body)


def render(source: pathlib.Path, title: str, description: str) -> str:
    body = re.sub(r'^#\s+.*\n', '', source.read_text(), count=1)
    body = rewrite_links(body, PAGES)
    return (f'---\ntitle: "{title}"\ndescription: "{description}"\n---\n\n'
            f'{{/* Generated from {source.relative_to(REPO)} by docs/sync.py. '
            f'Edit that file, not this one. */}}\n\n' + body.lstrip())


def main() -> int:
    check = '--check' in sys.argv
    stale, missing = [], []
    for page, (src, title, description) in PAGES.items():
        source = REPO / src
        if not source.exists():
            missing.append(src)
            continue
        target = ROOT / (page + '.mdx')
        wanted = render(source, title, description)
        if check:
            if not target.exists() or target.read_text() != wanted:
                stale.append(page)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(wanted)
    if missing:
        print('source missing: ' + ', '.join(missing), file=sys.stderr)
        return 1
    if stale:
        print('out of date, run python docs/sync.py: ' + ', '.join(stale), file=sys.stderr)
        return 1
    print('checked' if check else f'wrote {len(PAGES)} pages')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
