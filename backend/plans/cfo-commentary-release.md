# CFO commentary release notes

Status on September 20, 2026: implemented and verified with automated checks, a synthetic browser investigation using the configured Astra provider, real Deepgram browser playback, and real Jev review.

Implemented scope:

- A workspace-scoped, transactionally ordered journal stores deduplicated workflow events and exact narration text. Coverage includes AP worker starts, tool stages, results and failures, simulated supplier requests and replies, proposals, recorded approvals, and actual Devin/Elastic dispatch transitions. Queued, accepted, unconfirmed, and completed states remain distinct.
- Authenticated `GET /workflow/snapshot`, `/workflow/events?after=N`, and `/workflow/history?before=N` support initial state, incremental updates, and history. Initial history is not automatically replayed as speech.
- The world-level CFO runtime follows updates while the panel is closed. Demo, Essential, and Muted modes retain readable history. Exact-text Aura REST speech uses 24 kHz mono PCM, bounded playback, sentence captions, interruption handling, and private playback receipts. Stale events, changed evidence, revoked access, expired leases, and malformed audio are rejected.
- Concern cards expose three Jev-reviewed options and custom typed or spoken instructions. Revision-bound, idempotent decisions enqueue durable investigation work. The worker records operation receipts and checks current cited evidence before reporting completion. Missing input produces a new reviewed decision card.

Local setup:

Set the following in `backend/.env`. `CONCERN_MODEL` was missing in the local integration configuration and is required by the evaluator; restart the evaluator after changing it.

```dotenv
CONCERN_MODEL=openai/gpt-5-mini
CONCERN_RESOLUTION_ENABLED=true
CFO_COMMENTARY_AUDIO_ENABLED=true
CFO_TTS_CHARACTERS_PER_MINUTE=6000
```

Keep the existing server-side credentials configured: `AI_GATEWAY_API_KEY` for concern drafting/Jev evaluation, `DEEPGRAM_API_KEY` for speech, and the configured worker provider credential (`OPENAI_API_KEY`, or the AI Gateway fallback). Credentials are not sent to the browser.

From the repository root, `tools/dev-up.sh` starts the evaluator, API, and concern worker with the local stack. It leaves already-running processes alone. Restart the affected API, evaluator, or worker after editing environment settings. To run the decision worker separately:

```sh
uv run --directory backend python -m app.concern_worker
```

The worker processes accepted decisions and survives browser closure. Its local launcher log is `backend/var/concern-worker.log`; evaluator output is in `backend/var/evaluator.log`. Inspect `GET /concerns/{id}` and `/concerns/{id}/jobs/{job_id}` for durable decision, operation, and result state. A missing model credential leaves an explicit worker error; it does not imply completed work.

Verification recorded so far:

| Check | Result |
| --- | --- |
| Full backend suite after integration with current main | 447 passed, 11 skipped |
| Focused concern, journal, and audio suite with PostgreSQL checks enabled | 57 passed, no skips |
| Frontend tests | 42 passed |
| Frontend type check, lint, production build | Passed |
| Real Deepgram speech smoke test | Passed |
| Final affected backend suite | 93 passed, 5 optional PostgreSQL checks skipped (covered separately) |
| Real Jev card review | Approved: grounded 0.85, distinct 0.94, authority 0.90; unchanged 0.85 threshold |
| Real decision-worker smoke test | Browser-submitted custom investigation completed with durable receipts and current evidence |
| Browser Deepgram playback | Completed receipt: all 124,800 produced PCM samples played |

The focused PostgreSQL checks ran against a disposable local cluster. They cover committed journal ordering and rollback, concurrent decision acceptance, the execution lease during a nested domain mutation, and the workspace speech budget across concurrent users. Other regressions cover stale captions, revoked membership, late PCM after lease release, contradictory audio formats, unread evidence in completion reports, and persisted worker failures. Set `TEST_POSTGRES_URL` and `TEST_CONCERN_POSTGRES_URL` only to a disposable test cluster when enabling those optional tests. These counts describe overlapping suites and must not be added together.

The synthetic browser run investigated a price and quantity mismatch, read current source evidence, and returned its actual result to the world interface. Findings retain the worker's notes with an explicit unverified label. The real Jev check used synthetic invoice, purchase-order and receiving evidence. These checks do not claim a live external payment, a specialist dispatch, or word-perfect conversational caption timing.

Current limits:

- Commentary leases coordinate commentary requests for one user/workspace. Conversation and commentary do not yet share a cross-device playback fence.
- Commentary captions use the exact TTS input and follow PCM playback at sentence/cue level. Native conversation captions retain provider turn boundaries; there are no word-level timestamps.
- The decision worker has investigation and preparation tools. It cannot pay, post ledger entries, approve proposals, change permissions, or send external messages. A recorded approval is not a payment. Simulated counterparty activity is identified as simulation.
- The broader coverage, performance targets, soak test, and recorded demonstration in [the implementation plan](cfo-commentary.md) remain release targets unless separately verified. Automated provider fixtures do not prove a live specialist dispatch.

Set `CFO_COMMENTARY_AUDIO_ENABLED=false` to disable synthesis while preserving captions and workflow data. Set `CONCERN_RESOLUTION_ENABLED=false` to stop the resolution worker from claiming new work; accepted decisions remain durable. Neither setting grants financial authority or rolls back recorded domain actions.
