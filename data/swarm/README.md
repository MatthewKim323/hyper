# Luna process pool

Python owns a bounded pool of independent `codex exec` processes. Each job has an immutable source packet, dedicated `workspace/`, saved task, JSON schema, stdout event log, stderr log, final raw response, and metadata with session ID, model, token usage and hashes. No agent-tool delegation is used by this runner.

```sh
python3 data/swarm/run.py --workers 8 --limit 102
python3 -m unittest discover -s data/swarm -p 'test_*.py' -v
```

Run from the repository root after generating `data/generated/private/narrative_packets.jsonl`. Requires authenticated Codex CLI with `gpt-5.6-luna` access. Tested installed CLI: 0.154.0. Authentication remains owned by Codex; no credentials are copied into task folders.

A thread pool supervises external processes; it does not share model sessions. Task text is passed on stdin (not interpolated into shell code), and each subprocess receives its own `-C` directory. `--json` captures execution events, `-o` captures the final response, and `--output-schema` requests structured output. `--ephemeral` avoids persisting ordinary session files. Approved CLI capabilities were inspected with `codex exec --help`.

Completed jobs with an unchanged prompt hash are skipped after output validation. Each process has a 240-second timeout; its process group is terminated on timeout. Failed jobs remain marked failed and can be retried by rerunning the command. There is no automatic unlimited retry. `--workers` is capped at 12; 102 jobs does not imply 102 simultaneously active processes. Usage is charged against the account as usual. Logs can contain full synthetic source context and belong on the developer side only.

Generated narratives are drafts. Structure, dates, minimum length and source-reference membership are checked; those checks do not prove semantic correctness. They must not create ledger postings or overrule canonical source records. Original research/engine preparation briefly used two agent-tool workers before the user requested subprocess-only execution; those workers were stopped. Corpus generation uses only the subprocess pool.

Separate directories are operational isolation, not filesystem access isolation. `read-only` limits writes but does not seal arbitrary private data from a capable reader. Narrative writers are generation workers, not the evaluated financial defender. Mount only the export bundle in the defender's sandbox.
