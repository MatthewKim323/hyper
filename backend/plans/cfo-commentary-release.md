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

Production deployment checklist:

1. Obtain access to the existing Railway `hyper` project and the Vercel project serving `hyper.stephenhung.me`. The local Railway CLI is unauthenticated, and the current Vercel account cannot access that production project. Production project/service IDs and deploy triggers remain unverified. A main-branch merge alone does not establish that production updated. Confirm each service's GitHub source, selected branch, enabled autodeploy, and deployed commit. See [Railway autodeploys](https://docs.railway.com/guides/github-autodeploys) and [Vercel Git deployments](https://vercel.com/docs/deployments/git).
2. On `evaluator`, set `CONCERN_MODEL=openai/gpt-5-mini`. Preserve its `AI_GATEWAY_API_KEY`, matching `EVALUATOR_SECRET`, private network access, and `EVALUATOR_HOST=0.0.0.0`. Deploy the updated evaluator before exercising new concern cards.
3. On `api`, preserve the production database, Clerk/origin settings, evaluator URL/secret, and server-side provider credentials described in [deployment docs](../../docs/deployment.mdx). Set `CFO_COMMENTARY_AUDIO_ENABLED=true` and `CFO_TTS_CHARACTERS_PER_MINUTE=6000`; speech requires `DEEPGRAM_API_KEY`. Deploy the API and verify `/health`. Startup applies the additive database schema changes before the worker begins claiming decisions.
4. Add `concern-worker` as a separate Railway service with repository-root build context, `backend/Dockerfile`, `START_MODULE=app.concern_worker`, `APP_ENV=production`, and `CONCERN_RESOLUTION_ENABLED=true`. Reference the same production `DATABASE_URL`, `EVALUATOR_URL`, and `EVALUATOR_SECRET` as the API. Supply the configured investigation credential (`OPENAI_API_KEY`, or `AI_GATEWAY_API_KEY` fallback), preserving any intended `AUTO_AGENT_PROVIDER` and `AUTO_AGENT_MODEL` overrides. It needs no public domain.
5. Give the worker its own Railway config before deploying or connecting its GitHub source. The repository's root `railway.toml` sets `healthcheckPath="/health"`; this worker does not serve HTTP. Configuration in code overrides dashboard settings. Select the included `/backend/railway.concern-worker.json` as the worker's config path in its service settings. It supplies the following deployment configuration. Confirm the deployed settings have no HTTP healthcheck. See [custom Railway config paths](https://docs.railway.com/config-as-code#using-a-custom-config-as-code-file) and [config precedence](https://docs.railway.com/reference/config-as-code).

```json
{
  "build": {"builder": "DOCKERFILE", "dockerfilePath": "backend/Dockerfile"},
  "deploy": {
    "healthcheckPath": null,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
```

6. Deploy the frontend in the existing Vercel project with root directory `web/studio` and its production API/WebSocket URLs. In an authorized workspace, verify a fresh concern card, a submitted decision reaching durable job state, a completed investigation with receipts, and one commentary playback receipt. Worker process uptime alone does not prove it can claim or finish work. Confirm the deployed commits for API, evaluator, worker, and frontend match the release.

Once authenticated and linked to the existing project, the verified Railway CLI syntax for the new non-secret settings is below. These commands change production state and were not executed during the read-only audit. Configure the worker's build and health settings before connecting its source; add secret values through existing service references or the platform's protected variable UI.

```sh
railway add --service concern-worker --json
railway variable set --service evaluator --environment production --skip-deploys CONCERN_MODEL=openai/gpt-5-mini
railway variable set --service concern-worker --environment production --skip-deploys START_MODULE=app.concern_worker APP_ENV=production CONCERN_RESOLUTION_ENABLED=true
railway service source connect --service concern-worker --environment production --repo MatthewKim323/hyper --branch main --json
```

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

Final suggestion-retry follow-up:

- Jev rejection receives at most one targeted regeneration, followed by a fresh independent review. All calls share an 80-second deadline, below the API's 90-second timeout. The 0.85 review threshold is unchanged.
- Suggested choices now stay within three distinct investigations of existing evidence. They do not promise validated proposals or future financial outcomes for blocked cases. Custom instructions still use the worker's separately enforced capabilities.
- The world decision card exposes Retry suggestions when review fails, keeps typed input, and suppresses stale options during regeneration. Custom instructions also work when the first card failed at revision zero; numbered choices remain unavailable. Stale polling or retry responses cannot replace a newer voice decision.
- Nine evaluator tests pass for structured drafts, review thresholds, bounded retry, shared deadlines, and preserving an already-grounded summary during authority repairs. Nine affected frontend tests, TypeScript, and scoped ESLint pass for the final recovery changes.
- Final voice/decision regressions: 42 passed, one optional PostgreSQL test skipped. A browser submission from a synthetic card at failed revision zero reached the durable queue. This check does not claim the fixture worker completed that new job.
- A 16-second silent interface walkthrough was captured from the synthetic workspace and rendered with Recordly. It shows the decision card and commentary history, uses fixture suggestions, and does not demonstrate live speech or independently reviewed choices. The ignored local artifact is `web/studio/.dev/cfo-demo/demo.mp4`.
- A read-only real-provider check of the existing INV-0008 disputed cancellation still failed Jev grounding after the repair: grounding 0.84, distinctness 0.86, authority 0.94. Its suggestions remain unavailable and custom input remains usable. This is a review rejection, not a connection or credential failure.

Current limits:

- Commentary leases coordinate commentary requests for one user/workspace. Conversation and commentary do not yet share a cross-device playback fence.
- Commentary captions use the exact TTS input and follow PCM playback at sentence/cue level. Native conversation captions retain provider turn boundaries; there are no word-level timestamps.
- The decision worker has investigation and preparation tools. It cannot pay, post ledger entries, approve proposals, change permissions, or send external messages. A recorded approval is not a payment. Simulated counterparty activity is identified as simulation.
- The broader coverage, performance targets, soak test, and recorded demonstration in [the implementation plan](cfo-commentary.md) remain release targets unless separately verified. Automated provider fixtures do not prove a live specialist dispatch.

Set `CFO_COMMENTARY_AUDIO_ENABLED=false` to disable synthesis while preserving captions and workflow data. Set `CONCERN_RESOLUTION_ENABLED=false` to stop the resolution worker from claiming new work; accepted decisions remain durable. Neither setting grants financial authority or rolls back recorded domain actions.
