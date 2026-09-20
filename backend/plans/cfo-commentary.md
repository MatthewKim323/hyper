# CFO live commentary implementation plan

Status: planned, not implemented. Reviewed September 20, 2026 against the current Hyper checkout (inspection baseline `1c52d51`).

Confirmed product decision: **continuous demo commentary**. The CFO explains each meaningful workflow transition, handoff, result, blocker, and human decision. Quiet mode is secondary. Ordinary polling, repeated tool calls, and provider reasoning are not things to read aloud.

Confirmed interaction addition: escalations offer **three Jev-reviewed actions**, plus a custom typed or spoken instruction. The CFO records the user's choice, carries it through the authorized execution path, and narrates the actual result. Section 18 specifies this loop.

## 1. The experience

The central CFO speaks in short, composed sentences while actual work progresses. She names the item, explains who or what is handling it, and gives the purpose or consequence. The same words appear as clean captions, synchronized to playback. The relevant relic remains visible; its existing warm attention glow turns on only when the workflow needs the user.

Example, with every sentence gated by the corresponding committed fact:

1. "A new invoice has arrived. I'm having the accounts-payable agent review the price and quantity."
2. "The price doesn't match the purchase order. I'm moving this into evidence review."
3. "I've requested the credit memo from the supplier. That document is the next dependency."
4. "The supplier has replied. I'm checking whether the credit resolves the discrepancy."
5. "The checks passed. The proposal is ready for your approval."
6. "Your approval is recorded. No payment has been sent."

These are writing examples, not a scripted replay or guaranteed events in every run. In the sandbox, identify the workflow as a simulation and call counterparties simulated suppliers when ambiguity could imply real external communication. If a request is only queued, say queued; if dispatch is unknown, say unconfirmed.

The CFO must distinguish a true agent handoff from one agent changing tools. The current Astra AP worker performs several stages itself. It is inaccurate to invent an Audit AI agent merely because that worker called an evidence tool. A real Devin or Elastic dispatch can name the actual specialist once the dispatch record exists.

## 2. Existing pieces to reuse and gaps to repair

| Existing code | Reuse | Required change |
| --- | --- | --- |
| `backend/app/voice.py` | Deepgram conversation, current `aura-2-thalia-en` voice, session history, authorization hooks | Add a separate read-only commentary lane and explicit utterance metadata. Keep user conversation distinct. |
| `backend/app/main.py` dashboard socket | JWT/Origin checks, private user/workspace session, membership rechecks | Route commentary frames and playback receipts; cancel on scope/auth loss. |
| `backend/app/agent_events.py`, `swarm_feed.py` | Domain transaction boundaries, semantic deduplication, SSE/reconnect patterns | Add a commit-ordered workflow journal. Existing timestamp/UUID cursors cannot guarantee lossless concurrent replay. |
| `backend/app/auto_agent.py` | Actual AP run and tool execution | Emit live committed stage facts. Current detailed trace is saved after a whole session, too late for handoff narration. |
| `web/studio/lib/command/cfo-feed.ts`, `useCfoSwarm.ts` | Validation, tenant scope, bounded history, reconnect | Lift lifecycle out of the CFO panel; use a lightweight event stream for narration. Avoid continuously polling all Devin logs. |
| `web/studio/components/command/CommandLayer.tsx` | Persistent world voice owner | Add one CFO runtime and one output arbiter. Opening the CFO panel must not start another narrator. |
| `web/studio/lib/onboarding/voice-client.ts` | PCM decoding, audio scheduling, generation cancellation, playback analyser | Extract an utterance-aware playback queue with bounded buffering and a played-sample ledger. |
| `web/studio/lib/onboarding/dialogue.ts` | Transcript IDs, history dedupe | Stop merging adjacent assistant entries solely by role. Preserve utterance and turn boundaries. |
| `web/studio/components/onboarding/DialogueCaptions.tsx` | Existing typography and voice surface | Separate active caption from history. Current fixed-height masked stack can clip a long uninterrupted monologue. |
| `web/studio/lib/command/world-voice.ts` | Orb reacts to actual output audio | Feed both conversation and commentary through the same analyser and audible-state clock. |

Scope challenge: this crosses more than eight files because events, audio, captions, auth, and actual worker execution are separate today. The minimum complete solution repairs those boundaries. It does not require a new message broker, orchestration framework, voice model, financial agent, or 3D renderer.

## 3. Selected architecture

```text
Financial mutation / verified execution transition
  -> same transaction: workflow event + ordered workspace sequence
  -> authenticated incremental workflow feed
  -> deterministic narration candidate and relevance check
  -> exact text persisted for captions/history
  -> one user-scoped output arbiter
       conversation has priority over commentary
       one audible utterance at a time
  -> Deepgram Aura REST response streamed as PCM
  -> browser playback ledger
       + active sentence caption
       + CFO orb audio analyser
       + playback/interruption receipt

Relic activity consumes the same workflow facts, independently of speech.
Speech being muted, delayed, or broken never pauses financial work.
```

Introduce two cohesive backend modules: a workflow journal and a narration policy/transport module. Frontend responsibilities are pure queue/reducer helpers, the extracted player, and a single runtime mounted under the existing authenticated command session. Keep domain-specific fact extraction beside the domain code.

Narration is a read-only projection. It has no financial tools and never feeds its own speech or delivery receipts into the coordinator's work queue.

## 4. Deepgram transport decision

Use **streamed REST TTS per short, complete narration sentence**, retaining the existing voice:

```http
POST https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate=24000&container=none&mip_opt_out=true
Authorization: Token <server-held credential>
Content-Type: application/json

{"text":"The supplier has replied. I'm checking the credit memo."}
```

Deepgram documents streamed consumption of REST responses, so playback need not wait for the entire clip. Each HTTP response belongs to exactly one application utterance, avoiding ambiguous text/audio pairing on a shared provider conversation. Use a pooled server HTTP client. Explicitly configure format rather than relying on defaults. Preserve the existing model-improvement opt-out. [REST request](https://developers.deepgram.com/reference/text-to-speech/speak-request), [streaming REST audio](https://developers.deepgram.com/docs/streaming-the-audio-output), [media formats](https://developers.deepgram.com/docs/tts-media-output-settings).

Keep Voice Agent for questions, microphone turns, and existing tool-enabled conversation. Both routes converge on one browser audio output. Narration-only use must not request a microphone or keep an unused STT session open. Move the current automatic CFO greeting into the exact-text REST lane; otherwise world entry still starts the existing conversational provider and its keepalive. Start Voice Agent lazily for typed input or an intentional microphone session. When the microphone is off, close it after a 30-second idle period only once tool work and local reply playback have finished, preserving conversation history.

Alternatives reviewed:

| Approach | Decision |
| --- | --- |
| `InjectUserMessage` | Reject for narration. It fabricates a user turn and invokes the conversational model. |
| `InjectAgentMessage` | Valid for literal speech, but not the default: shared turn timing, possible refusal during user speech, and no documented application utterance ID complicate caption correlation. |
| Aura TTS WebSocket | Useful for incrementally arriving text. Our sentence is already complete, so an HTTP response is a simpler correlation boundary. |
| Flux TTS v2 | Has stronger turn/interruption metadata, but changes the voice/protocol. Evaluate separately after the existing-voice path passes. |

The dedicated injection contract uses `message` and supports `default`, `queue`, and `interrupt`; a refused injection is not spoken. Voice Agent text has no documented native per-word playback timestamps. Server `AgentAudioDone` is not browser playback completion. These limitations are why this plan owns the audio ledger. [Injection contract](https://developers.deepgram.com/docs/voice-agent-inject-agent-message), [conversation text](https://developers.deepgram.com/docs/voice-agent-conversation-text), [audio completion](https://developers.deepgram.com/docs/voice-agent-agent-audio-done), [Flux migration](https://developers.deepgram.com/docs/flux-tts/migrating).

REST tradeoff: each sentence incurs synthesis startup and can introduce a gap. Start with one request in flight and measure. Do not trade reliable attribution for speculative audio queues. Aborting our HTTP stream stops delivery; it does not guarantee canceled provider computation or refunded usage. Keep sentences coherent rather than splitting every few words. [Chunking guidance](https://developers.deepgram.com/docs/text-chunking-for-tts-optimization).

## 5. Authoritative workflow event contract

Use a dedicated `workflow_events` journal so narration cannot accidentally wake the existing coordinator through `agent_events.acknowledged`. Reuse existing transaction helpers, not that acknowledgment field.

```ts
type WorkflowEvent = {
  schemaVersion: 1;
  id: string;
  sequence: number;           // committed workspace order, not wall-clock order
  eventKey: string;           // semantic idempotency key
  kind: WorkflowEventKind;
  occurredAt: number;
  recordedAt: number;
  workflowId: string;
  runId?: string;
  taskId?: string;
  caseId?: string;
  operationId?: string;
  parentEventId?: string;
  entityRevision?: number;
  actor: { kind: "cfo" | "worker" | "specialist" | "engine" | "human"; id: string };
  recipient?: { kind: "worker" | "specialist" | "supplier" | "procurement" | "human"; id: string };
  state: "queued" | "started" | "waiting" | "needs_input" | "completed" | "failed" | "unknown";
  fromStage?: string;
  toStage?: string;
  section?: "cases" | "evidence" | "review" | "timeline" | "benchmarks" | "identity";
  simulated: boolean;
  facts: AllowlistedFacts;
};
```

`AllowlistedFacts` is a discriminated schema per kind, not arbitrary JSON. It may contain invoice ID, request category, verified source IDs, proposal ID/hash/revision, currency and exact minor units, validated check counts, or a public blocker code. Missing required facts means a neutral fallback sentence or caption-only event, never invented details. Use decimal/integer formatting and currency-aware language; never recalculate financial amounts in the narrator.

Suggested tables:

- `workflow_stream_heads`: workspace and last sequence.
- `workflow_events`: workspace, sequence, immutable typed event, unique semantic key. Indexed `(organization_id, sequence)` and `(organization_id, workflow_id, sequence)`.
- `cfo_narrations`: canonical fact-backed text, template version, source event IDs, text hash, priority, supersession key, relevance/version predicate. Shared narration uses role-neutral wording. Any personalized wording is a separately persisted recipient-scoped utterance with its own exact text/hash, never an on-the-fly speech-only rewrite.
- `cfo_deliveries`: private user/workspace narration delivery records, mode, lease epoch, status, playback receipts. Separate seen, queued, and played cursors.

Allocate the workspace sequence under one counter-row lock held through the domain/event transaction. A plain auto-increment alone can allocate before commit and still allow out-of-order commits. Keep locks short, acquire in one documented order, never perform network/model calls under them, and retry deadlocks with the same semantic key. Test on PostgreSQL as well as SQLite. PostgreSQL row locks persist until transaction end. [PostgreSQL locking](https://www.postgresql.org/docs/current/explicit-locking.html).

Migration is additive and idempotent. Do not backfill old rows as new spoken events. Establish a cutover watermark. If a reconnect cursor predates retention, return an explicit gap plus an authoritative current-state snapshot, not a silent jump. Retain workflow/narration text according to the workspace retention policy; proposed default for delivery diagnostics is seven days, with PCM ephemeral and excluded from durable logs.

## 6. Event coverage and CFO language

All event names below are proposed contracts, not a claim they already exist.

| Trigger, emitted at committed transition | CFO intent / example | Current instrumentation point |
| --- | --- | --- |
| `invoice.received` / `source.received` | "A new invoice is ready for review." | Counterparty intake or source import transaction |
| `work.queued` | "I've queued the invoice review for the AP agent." | Both direct investigation start and coordinator delegation |
| `work.started` | "The AP agent has started checking the invoice." | Confirmed worker claim/provider session, not queue insertion |
| `handoff.queued` | "I'm handing the contract review to our evidence specialist to verify the terms." | Actual delegation record, with recipient and purpose |
| `handoff.accepted` | "The evidence specialist has picked up the review." | Accepted dispatch/provider run identity |
| `checks.started` | "I'm checking the invoice against the purchase order and receipt." | AP tool operation with stable run/operation ID |
| `checks.blocked` | "The billed quantity exceeds what we received. This needs supporting evidence." | Deterministic accounting result, version and blocker code |
| `evidence.requested` | "I've requested the credit memo. The case is waiting on the supplier." | Request insertion in `counterparty.py`, one event per idempotent request |
| `evidence.received` | "The supplier has replied. I'll verify the document before proceeding." | Stored reply, not evidence validation |
| `evidence.verified` | "The credit memo is verified. I'm returning the case to reconciliation." | Successful inspection result tied to source/version |
| `proposal.prepared` | "The checks passed. The proposal is ready for your approval." | Proposal creation, all required check facts present |
| `approval.recorded` | "Your approval is recorded. No payment has been sent." | Owner decision transaction, current hash and revision |
| `work.held` / `user.input_required` | "I'm holding this case until we have the missing receipt." | Actual persisted hold or concern awaiting response |
| `work.failed` / `dispatch.unknown` | "I couldn't confirm the handoff. The case remains open." | Worker/specialist failure or ambiguous dispatch |
| `work.completed` / `artifact.ready` | "The investigation is complete. The findings are available in Audit and Evidence." | Persisted result and authorized artifact/citations |
| `evaluation.started/completed` | "The new framework version is being evaluated against the recorded cases." | Real live evaluator lifecycle, never an imported sample |
| `skill.proposed/activated` | "A new workflow improvement is ready for review." | Actual skill record and activation decision |
| `connection.needs_auth` | "The accounting connection needs you to sign in again." | Connector state transition |
| `posting.committed` / `settlement.confirmed` | Exact action and amount only after the corresponding financial authority confirms it | Domain-specific posting/settlement transaction |

Complete AP demo coverage first, then actual Devin/Elastic handoffs, then every active financial module. For unsupported modules, show existing factual status without pretending narration coverage exists. Maintain an event-to-template registry and a coverage test so new kinds cannot silently disappear.

Operational facts:

- `auto_agent.py` currently calls data tools directly. Publish run start/end and operation transitions there; publish domain results inside their domain transactions, not a duplicate generic wrapper.
- Instrument `orchestrator.py` direct start and delegation, `devin_worker.py` accepted/uncertain launch, and `elastic_investigations.py` queued/started/completed/failed.
- Instrument proposal creation/owner decisions in `accounting.py`, requests/replies in `counterparty.py`, and attention/resolution in `concerns.py`.
- Provider messages remain supplemental evidence. Raw tool arguments, retrieved text, grading answers, and private reasoning are never narration input.
- External dispatch is an intent followed by a receipt, not an atomic local fact. Persist intent, call the provider, then record accepted/failed/unknown. Reconcile ambiguous outcomes rather than announcing success.

## 7. Voice and writing policy

Use versioned deterministic templates with small curated variations. Select a variant once per narration ID and persist it. Do not put another generative model between a financial fact and its spoken claim.

Default structure: **item + action/recipient + reason or next dependency**. Usually one sentence, occasionally two short sentences. Aim for 10 to 24 words per sentence; hard cap each synthesized utterance at 240 characters and split longer updates into complete semantic sentences. No repeated "Okay", no reading JSON, no tool names, no generic "processing your request" filler.

Use "queued", "started", "verified", "prepared", "approved", "posted", and "paid" as different states. Receiving a document is not verifying it. Passing a simulation is not resolving a real invoice. Preparing or approving a proposal is not sending a payment. A dispatch acknowledgment is not task completion.

Use "ready for approval" in shared workspace narration. A recipient-specific "your approval" variation must have a separate private text/hash and a current reviewer-capability check. The narrator can say "our investigation agent" for a known registered worker. It must not assert that the conversational CFO personally executed a task when another worker did. Capability/role-aware copy says "ready for approval" to a member and "ready for your approval" only to an authorized reviewer.

## 8. Continuous commentary without a stale monologue

Product modes:

- **Demo**, default for the requested experience: every meaningful stage transition and handoff, deduplicated and coalesced.
- **Essential**: decisions, blockers, material outcomes; available as a quieter option.
- **Muted**: no synthesis, live captions and history remain available.

Scheduler policy, initial tunable values:

| Rule | Initial policy |
| --- | --- |
| Concurrent audible speech | One utterance across conversation and commentary |
| Priority | User speech/typed request, direct CFO answer, urgent blocker/decision, handoff/result, routine progress |
| Coalescing | Up to 500 ms for adjacent routine facts in the same workflow |
| Pending backlog | At most four utterances or 20 seconds estimated speech, whichever is reached first |
| Routine expiry | 15 seconds; replace with current state when obsolete |
| Decision/blocker expiry | Revalidate instead of dropping; stop once resolved or inaccessible |
| Fairness | Preserve case-local causality; round-robin eligible cases within priority |
| Catch-up | One current summary after interruption/reconnect/return, not a replay of every missed line |
| Hidden tab | Stop mic capture and audio, cancel synthesis, retain server facts, offer current summary on return |

Every eligible event receives a recorded disposition: narrated, caption-only, merged into another narration, superseded by a later state, or suppressed with a policy reason. Coalescing does not erase the detailed timeline.

Revalidate entity revision and authorization immediately before synthesis and again before playback. If an approval is revoked or a proposal becomes stale while queued, cancel that sentence. If a statement becomes false mid-speech, stop it and issue a concise correction from the new event. Conversation always preempts commentary; essential workflow facts remain in history and the next relevant summary.

## 9. Utterance and audio protocol

Persist exact caption text before starting synthesis. Use the existing authenticated dashboard transport to send versioned frames. The server accepts a narration ID, not arbitrary unvalidated browser text to synthesize.

```ts
// Server -> browser: text is durable even without an audio lease.
{ type: "narration.ready", narrationId, utteranceId, turnId,
  workspaceScope, eventIds, text, textHash, templateVersion,
  source: "commentary", priority, entityRevision, expiresAt }

// An immutable audio envelope is registered before accepting any samples.
{ type: "audio.start", utteranceId, workspaceScope, source: "commentary",
  generation, outputEpoch, leaseEpoch, leaseGrantId, leaseExpiresAt,
  encoding: "linear16", sampleRate: 24000, channels: 1 }

// Each audio frame references and must match that envelope.
{ type: "audio.chunk", utteranceId, generation, outputEpoch, leaseEpoch,
  leaseGrantId, chunkIndex, startSample, sampleCount, pcm: "base64" }
{ type: "audio.end", utteranceId, generation, outputEpoch, leaseEpoch,
  leaseGrantId, totalSamples }
{ type: "audio.cancel", utteranceId, generation, outputEpoch, leaseEpoch,
  leaseGrantId, reason }

// Browser -> server: authorized, idempotent, and lease-fenced.
{ type: "narration.play", narrationId, utteranceId, requestId,
  outputEpoch, leaseEpoch, leaseGrantId }
{ type: "narration.cancel", utteranceId, requestId, outputEpoch,
  leaseEpoch, leaseGrantId, reason }
{ type: "playback.receipt", utteranceId, generation, outputEpoch,
  leaseEpoch, leaseGrantId,
  state: "started" | "completed" | "interrupted" | "blocked" | "failed",
  playedSamples, receiptId }
```

`workspaceScope` is an opaque server-provided identity; it does not authorize data access. Scope, utterance, source, generation, output epoch, and lease must match the immutable registered envelope before scheduling any PCM. Commentary and conversation have separate source generations; a shared output epoch fences ownership across both lanes. A local interruption advances the output fence immediately, without waiting for a server acknowledgment. No chunk can register itself as a new utterance. Unknown or stale envelopes are rejected. Preserve partial two-byte samples across HTTP chunk boundaries. Validate content type, configured sample rate, channel count, byte limits, total sample bounds, chunk ordering, and end count. Reject malformed or duplicate chunks; gaps must cause bounded recovery or caption-only failure, never unidentified audio.

The dashboard socket receive loop must stay available for control messages. Start TTS in a tracked cancellable asyncio task per admitted utterance, with a bounded output channel and priority handling for cancellation/auth messages. Never await the whole REST stream or an unbounded send inside the socket control handler. Apply send/read/header timeouts; if the transport cannot carry a stop signal, the browser already stops locally and fails to caption-only. Task cleanup must run on cancellation, scope loss, disconnect, and normal completion.

The HTTP request object owns its utterance and generation. Cancellation aborts its reader and ignores late results. Do not label stale provider bytes with a new generation simply because the current session generation changed.

Keep short network buffers, initially 150 to 300 ms startup and at most two seconds scheduled ahead, with a bounded remainder queue. Hard bound total pending decoded PCM per utterance to 15 seconds. At 24 kHz mono float playback this is about 1.44 MB, before small bookkeeping overhead. If output exceeds that bound, stop it and retain the text. Never create an unbounded collection of AudioBufferSourceNodes.

Only local playback completion is a completion receipt. Server EOF just means all samples were produced. Browser acknowledgments are presentation telemetry and must never authorize or advance financial state.

## 10. Captions that remain correct

```text
verified text -> stored transcript entry -> audio prepared -> scheduled samples
                                               |
                            local output clock reaches first sample
                                               v
                                    active sentence caption
                                               |
                        local drain / interruption / output suspension
                                               v
                              completed / interrupted / paused
```

The exact persisted sentence is used for both Deepgram input and caption text. Do not transcribe the CFO's own synthetic output as the primary caption source. Do not run an independent paraphraser. No character-by-character timer or guessed karaoke highlighting.

For commentary, one synthesized sentence is one caption cue. Display it at the associated first output sample, hold through the last sample, then advance. Use `AudioContext.getOutputTimestamp()` where available to account for output timing; fall back to the scheduled audio clock and available latency information, then measure the actual supported browser behavior. Device timing estimates are not a claim that sound has physically reached the listener. [Audio output timestamps](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp).

On interruption, mark the sentence interrupted. Retain its full text in history as an interrupted message, not as completely heard. Without word alignment, do not guess an exact spoken word boundary. No later cue from that utterance may become active.

UI rules:

- One active short cue, high-contrast text, with its owning invoice/workflow reference available.
- Reserve space for the active cue. Never mask, ellipsize, or silently clip current speech. At small widths or 200% zoom, allow the caption area to grow or scroll accessibly rather than reducing text below readable size.
- Full history lives in the CFO panel with explicit utterance boundaries, source events, and delivered/interrupted/caption-only status. Preserve the existing clean voice surface and central orb.
- Caption-only mode shows updates immediately and provides an accessible history when updates outrun reading speed. It never labels them spoken.
- Muting commentary is separate from stopping the microphone. Captions stay on by default.
- Autoplay failure shows "Enable CFO audio" in the existing voice surface; no microphone request. Attempt unlock from the existing Enter/user gesture, then observe whether it succeeded.
- Screen-reader live announcements occur once per new cue. History is not another continuously announcing live region. Provide an audio-description preference to avoid the app voice and assistive voice speaking over each other.
- Reduced motion affects transitions, not text availability or timing.

Interactive CFO replies need the same utterance ledger, but the present Voice Agent protocol lacks precise text/audio IDs. Before claiming identical alignment for conversation, run a provider trace covering multi-sentence answers and interruptions. Pair provider speaking turns conservatively; show turn-level captions when sentence pairing is not established. Never silently pretend arrival-order text is word-aligned speech.

## 11. Audio arbitration and lifecycle

```text
queued -> relevance check -> synthesizing -> ready -> playing -> completed
                 |                 |            |        |
          superseded          captionOnly   blocked   interrupted
```

One owner under the authenticated world command session handles conversation and commentary. Both use one playback context, analyser, and caption presentation. The orb's speaking state follows currently audible PCM, not a network event or a future scheduled buffer. The user's microphone glow continues to represent input.

On typed submission or detected user speech: stop commentary locally first, advance its generation, cancel synthesis, record interruption, and let the conversational response own output. After the answer drains, offer at most one still-relevant catch-up before returning to live events. Do not inject narration into conversation as a user message. Give the conversation a read-only recent-activity lookup so it can answer follow-up questions about what was said.

Use a per-user/workspace server playback lease with a fencing epoch so only one tab/device receives commentary audio. A browser Web Lock plus BroadcastChannel can coordinate local tabs, but server fencing remains authoritative. Use explicit grant identity, renewal, and a conservative local expiry deadline. Schedule a silence deadline on the audio output itself and never queue samples past the valid lease horizon, so a stalled JavaScript thread or partition cannot keep old PCM audible indefinitely. Renew only on an acknowledged current grant. Grant a competing audible lease only after acknowledged local stop or prior expiry plus the bounded output/drift margin. Stop and discard buffers on lease loss; server fencing alone cannot silence audio already buffered in a disconnected tab. Transfer can never replay an ambiguously heard old utterance automatically. [Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API).

On route leave, hidden tab, logout, membership loss, or workspace switch: stop playback and capture, clear private pending state, abort TTS, release leadership, and detach the old event stream. Keep real financial jobs running. On return, obtain a consistent authorized current-state snapshot and its workspace sequence S from the same database read view. Render the catch-up from that snapshot, then replay all committed events strictly after S before following live updates. Never separately fetch a summary and then read a newer watermark, which can skip intervening events. An event must appear either in the snapshot/catch-up or in post-S replay. Record historical/catch-up dispositions without automatically replaying old speech.

The existing Voice Agent keepalive/session rotation belongs only to that protocol. Do not send its KeepAlive message to a TTS REST request. Preserve onboarding's current readiness plus local-audio-drain gate when extracting the shared player.

## 12. Auth, reliability, and cost boundaries

Use existing Origin validation, JWT handshake, private session ownership, membership checks, and per-event authorization. Commentary subscribes to exactly the authenticated workspace. Recheck record visibility before display and synthesis. Keys remain server-side. TTS receives only the authorized sentence, not the full invoice, provider log, bank details, or hidden simulation facts.

Narration should not turn an availability problem into an accounting problem. Domain events are committed with domain facts, but a failed TTS call cannot roll back, retry, or duplicate a financial action. Unknown event kinds remain visible in the timeline and generate a diagnostic; they cannot be fed to a model for guessed interpretation.

Reuse the dashboard WebSocket for speech and control frames. Use a lightweight indexed journal stream for workflow changes, ideally sharing one world-level subscription with the CFO display. Keep expensive provider-history pagination lazy when the activity panel is opened. Do not add a permanent provider-log poll solely for narration.

No speech is synthesized for muted, hidden, unauthorized, or non-leading clients. Log characters submitted, request latency, byte count, cancellation, event backlog, and fallback counts using opaque IDs. Do not log secrets or raw financial sentences in ordinary diagnostics. Retry a TTS failure at most once before any playback has started, only while its fact is still current. After partial playback, default to transcript plus explicit replay rather than surprise repeated speech. Respect 429 backoff and configured per-workspace usage limits.

Exactly-once event creation is achievable with transaction/idempotency rules. Exactly-once sound across a client crash and a lost receipt is not provable. The recovery policy is deliberate: preserve text, mark playback uncertain, and do not automatically repeat it.

## 13. Failure matrix

| Failure | Required behavior | Proof |
| --- | --- | --- |
| Transaction rolls back | No corresponding narrated event | PostgreSQL transaction test |
| Transactions finish out of order | No missed event past live cursor | Concurrent commit/replay test |
| Worker crashes after dispatch | Reconcile; say unconfirmed, not started twice | Dispatcher recovery test |
| Same request/event delivered repeatedly | One canonical narration; no repeated automatic playback | Idempotency and reconnect tests |
| Event arrives while panel closed | Narrator still receives it | Browser integration |
| Approval becomes stale while queued | Supersede it before speech | Entity-version race test |
| Event burst exceeds speech speed | Coalesce current state; retain each event's disposition | Queue pressure test |
| TTS times out, 429s, or returns bad audio | Caption survives; bounded retry; no false speaking state | Fake provider fault suite |
| Odd-byte PCM boundary / missing chunk | Preserve sample carry or fail safely, no crackle/wrong attribution | PCM fixtures |
| Text arrives before audio | History may update; spoken cue waits for its output interval | Controlled audio-clock test |
| Server ends while playback remains | Caption/orb finish on local drain | Real browser audio test |
| User interrupts / types mid-sentence | Stop old sound/cue; answer takes precedence | Barge-in test |
| AudioContext suspends / output stalls | Pause cue progression; visible availability state | Browser fault injection |
| Mute / autoplay block | Caption-only, no mic prompt, explicit audio enable affordance | Browser permissions matrix |
| Closed tab / expired token / lost membership | No further private audio/text; correct cleanup | Auth and lifecycle tests |
| Reconnect after uncertain playback | No automatic duplicate speech; current catch-up only | Lost-receipt test |
| Two tabs/devices, including a partitioned former leader | Local audio expiry; takeover waits for stop/expiry; stale epoch cannot play | Partition, timer-throttling, and lease-fencing tests |
| Event commits between snapshot and live subscription | Event appears in snapshot or post-S replay | Snapshot-boundary concurrency test |
| REST headers/read/send stalls during barge-in | Socket control loop stays live; local output stops immediately | Async cancellation/backpressure tests |
| First world entry with commentary only | Exact greeting, zero STT sessions, zero microphone requests | Provider creation spy plus browser permissions test |
| Long sentence / 320 px / 200% zoom | Current cue remains fully accessible | Layout and accessibility checks |
| Domain service is down | Clear factual availability message; no invented progress | Integration failure fixture |

No failure above is accepted as a silent drop. Every one has both a user-visible outcome and an automated or explicit browser check.

## 14. Build sequence and commits

| Step | Work | Exit condition |
| --- | --- | --- |
| 1. Event contract and journal | Versioned schemas, sequence/idempotency, migration, replay/gap handling, auth | Concurrent PostgreSQL tests pass; old history is never newly spoken |
| 2. Real workflow coverage | Instrument AP worker/domain commits, Devin/Elastic handoffs, review lifecycle | A real sandbox invoice has a complete factual event trace before adding audio |
| 3. Deterministic narrator | Templates, priorities, dedupe, version checks, backlog, durable dispositions | Golden event traces produce the approved CFO lines and no unsupported claims |
| 4. Playback/caption foundation | Extract shared PCM queue, utterance reducer, caption history and active cue | Audio-clock, interruption, clipping, and onboarding regression tests pass |
| 5. Deepgram TTS bridge | Per-utterance HTTP streaming, scope/lease, cancel/fallback, response validation | Actual configured key/voice smoke test passes without exposing credentials |
| 6. World integration | Always-mounted runtime, conversation priority, mute/caption controls, orb | Panel closed/open behaves identically; no overlapping voices |
| 7. Wider financial coverage | Active posting, settlement, accrual, concerns, connections, skills/evaluations | Coverage registry proves event-to-caption disposition for every supported transition |
| 8. Demo and hardening | Full fault matrix, browser pass, sustained run, synchronized demo recording | Release gates below pass; bounded usage, no leaked processes |

Parallel lanes after agreeing the contract: backend event instrumentation and frontend playback/captions can proceed independently in isolated worktrees. Narration policy can be tested against shared fixtures. The Deepgram bridge follows the utterance contract, then integration follows both lanes. `main.py`, `voice.py`, `CommandLayer.tsx`, and the shared voice client each need one designated editor during integration to avoid concurrent rewrites. Keep commits real and scoped to these steps.

Rollout flags: `CFO_COMMENTARY_ENABLED`, `CFO_COMMENTARY_MODE`, `CFO_COMMENTARY_AUDIO_ENABLED`. First enable captions/event dispositions in the local demo, then TTS, then a scoped workspace rollout. An audio flag rollback leaves workflow data and captions intact. Do not reset onboarding or alter financial permissions to make a demo pass.

## 15. Release gates and demo recording

All numbers below are **targets to verify**, not measured promises or provider SLAs.

- All registered meaningful demo transitions have an explicit narration/caption disposition, with no unaccounted eligible events.
- Zero duplicate automatic playback in deterministic reconnect, duplicate-event, and two-tab tests.
- Caption text exactly equals stored TTS input for every commentary utterance.
- Visible caption onset within 100 ms of measured local output onset in controlled supported desktop browsers; document device/browser outliers instead of hiding them.
- Caption never advances to the next sentence before its audio begins. No active text clipping at 320/768/1440 px, 200% zoom, and reduced motion.
- Local interruption target under 150 ms from the application receiving the interrupt signal. Measure speech-detection latency separately.
- Target p95 committed-event-to-eligible-caption under one second; target p95 eligible-utterance-to-first-audio under two seconds on the demo environment, excluding deliberate queue wait. If the provider misses this, use clear caption-first behavior rather than fictional live timing.
- Fifteen-minute demo soak, bounded queue/memory, no narration while hidden, no extra 3D render passes, no multi-voice overlap, no stale financial claims.
- Integration traces cover one real AP scenario, one actual specialist dispatch when configured, one hold, one user interruption, one TTS outage, and one reconnect. Synthetic fixtures are labeled; they do not prove a provider integration worked.

Testing layers:

```text
Domain transaction tests -> workflow replay/concurrency tests
                                |
Template truth/golden tests -> queue/relevance/priority tests
                                |
Fake streaming TTS -> PCM ownership/drain/interruption tests
                                |
Actual Deepgram smoke -> browser captions/audio/orb integration
                                |
Full sandbox workflow + faults -> recorded evidence + rollout gate
```

Use existing pytest and Bun suites for deterministic checks, PostgreSQL for concurrency checks, and computer-use/browser tests for real caption layouts and microphone/autoplay behavior. For audio synchronization, record both audio and frame/playback diagnostics; a silent screencast cannot prove caption sync. The final short Editskill demo must capture actual CFO output audio, show a verified handoff, an approval cue, a user interruption, and caption-only recovery. Recordly project and MP4 are deliverables; no simulated voice substituted for the actual integration.

## 16. Deliberately deferred

- Word-by-word karaoke captions: no documented native alignment in the selected path; sentence alignment is the truthful initial contract.
- New speech model/Flux migration: retain the established CFO voice and measure the simpler transport first.
- Freeform LLM-written operational narration: deterministic text protects financial claims and reduces latency.
- New autonomous actions, agents, financial permissions, or payment execution: commentary observes the existing workflow.
- Decorative handoff particles, new navigation, or colored status rings: existing relic movement and warm attention glow communicate state.
- Reading every raw provider log or internal reasoning step aloud: retain inspectable logs, narrate meaningful facts.
- A promise that external audio can never fail: the guarantee is retained, truthful captions with tested recovery, not impossible provider uptime.

## 17. Decisions and remaining verification

Settled: continuous demo mode; existing CFO voice; streamed REST TTS for deterministic commentary; user conversation has priority; sentence-level playback captions; persistent text fallback; no fake handoffs; one audio owner; no new financial authority.

Implementation spikes that must produce evidence before release: configured Deepgram key access to direct Aura REST, actual PCM format/stream latency, Voice Agent conversation text/audio pairing, supported browser output timing, and the availability of real Devin/Elastic dispatches. Failure of any spike is reported as a concrete limitation; fixtures cannot be presented as live proof.

Review outcome: backend, frontend/audio, and current Deepgram contracts reviewed independently. A second draft challenge identified and resolved greeting/STT startup, recipient text scoping, complete lease fencing and expiry, nonblocking TTS cancellation, and snapshot-to-live replay races. The plan addresses the event-ordering race, missing AP telemetry, closed-panel subscription, caption clipping, premature captions, stale audio, backlog, and cross-tab duplication. Runtime behavior has not been changed by this planning pass.

## 18. Escalations: three choices, custom response, actual execution

### The interaction

The CFO identifies the anomaly, explains why it needs a decision, and presents exactly three distinct actions beside the current caption. Each has a short title, a concrete next step, and a brief tradeoff. Evidence is available on demand. Use three clean numbered action rows in the existing CFO voice surface, not three new floating windows or navigation. Keep the central orb and existing warm attention glow.

Illustrative price-mismatch decision, only when supported by the case evidence:

> "This invoice's price differs from the purchase order. We can check the contract, review prior approved invoices, or keep the case on hold for procurement review."

1. **Check the contract.** Compare the billed rate with the current signed agreement. Best when the purchase order may be outdated.
2. **Review prior invoices.** Investigate whether an approved exception explains the rate. Past treatment is evidence, not permission to repeat it.
3. **Keep it on hold.** Prepare a procurement review with the discrepancy and supporting documents. It remains unresolved until someone verifies the terms.

These are examples, not fixed options for every anomaly. The user can click an action, say "go with option two", or type/say a custom instruction such as "compare the amended contract first, then prepare a review if it still differs." A clear authorized instruction starts without another routine confirmation. The CFO acknowledges the recorded choice, explains the next step, and reports execution milestones and the supported outcome.

Do not auto-select an option. While this decision is foregrounded, pause routine spoken commentary so it cannot bury the choices; continue retaining workflow events and keep urgent unrelated blockers discoverable. After the answer is accepted, resume with a short relevant update. Only one decision owns numbered voice references at a time. Other pending concerns remain available without silently changing what "option two" means. Closing or deferring a decision never resolves it or permits blocked work to proceed.

### Reuse what exists

| Existing implementation | What it already does | Required addition |
| --- | --- | --- |
| `backend/evaluator/concerns.mjs` | `CONCERN_MODEL` drafts exactly three options; `typesafe-ai/jev` reviews groundedness, distinctness, and authority, each requiring probability at least 0.85 | Version the evaluated card and evidence snapshot; bind the displayed and spoken options to that version |
| `backend/app/concerns.py` | Strict three-option schema, custom text, persistent decision, queued/resolving states, leased claim and completion | Revision-aware and idempotent user response, refreshed decisions after new evidence, complete execution events |
| `backend/app/concern_api.py` | Authenticated workspace-scoped response route | Explicit responder capability, expected revision, stable command ID, accepted execution receipt |
| `web/studio/components/workspace/sections.tsx` | Review already displays three buttons, typed custom response, and outcome history | Extract a shared decision presenter; integrate with the live CFO surface and voice context |
| `backend/app/devin_worker.py` | Coordinator is instructed to continue on `concern.responded`, claim concerns, delegate work, and resolve with citations | Prove the configured consumer actually picks up the decision; correlate concern, decision, task, and result |

Jev currently evaluates proposed options; it is not the option-writing model. Preserve that division and describe the choices as Jev-reviewed. Its model scores are not calibrated probabilities that an action is financially correct, and they never grant execution authority. Keep evaluator details in inspection views instead of making them the main decision copy.

### Decision identity and user intent

Add an immutable `cardRevision` and hash of the evaluated card/evidence set. Store a monotonic `decisionRevision` separately from timestamps. The active UI context contains the concern ID, card revision/hash, fixed ordered option IDs, and a context generation. Bind a microphone turn to that context when it begins; a new alert must not retarget an in-progress utterance.

All three input routes converge on one authenticated user command:

```ts
type ConcernDecisionCommand = {
  commandId: string;
  concernId: string;
  expectedDecisionRevision: number;
  cardRevision: number;
  cardHash: string;
  input: "click" | "text" | "voice";
  choice:
    | { optionId: "option_1" | "option_2" | "option_3" }
    | { optionId: "custom"; instruction: string };
  userTurnId?: string;
};
```

The server derives user/workspace identity from the authenticated session. Load the option's action from the stored card, never from a browser-supplied action string. For custom responses, persist the original committed text and the normalized execution objective separately so interpretation cannot quietly replace what the user requested. The generated objective is not new authority.

Process only a committed user speech turn, never an interim transcript, assistant echo, narration text, or a statement inside a source document. Conversational questions such as "what would option two do?" explain the choice and do not submit it. Negation, conflicting choices, a stale context, or an unclear target produce one focused clarification. A clear final "do option two" can submit directly. Spoken financial amounts or recipients that remain uncertain must be clarified before a consequential operation. Voice is an input method under the current session, not proof of identity or an extra permission level.

Use a narrowly scoped conversation command handler bound to the real user turn. Do not add an unrestricted `respond_concern` tool to autonomous workers or let a model invent a user ID/approval. A parsed intent must pass the same server checks as a button click. Dedupe a voice tool retry and a UI retry by the same command/turn identity.

### Accept, execute, report

```text
anomaly + cited evidence
  -> card generation -> Jev review -> versioned three-option decision
  -> user choice/custom instruction -> authorized atomic acceptance
  -> concern.responded + durable execution reference
  -> configured worker claim -> investigation / supported action
  -> result evidence -> resolved, needs input, or failed
  -> CFO outcome caption and speech
```

Acceptance must atomically check current concern state, card/decision revision, relevant evidence freshness, and the user's response capability, then persist the decision, exactly one durable resolution job, and event. One concurrent response wins. A retry of the same command returns the same accepted result; reuse with different contents conflicts. A stale choice stays unsubmitted and refreshes the decision. Return a decision ID, queued status, and durable work reference. "Saved" or a successful HTTP response is not proof that execution started.

Selecting a response currently commissions investigation and preparation only. Execute those authorized steps through the existing tools and worker immediately after acceptance. For any action needing an existing domain approval, prepare that approval with its exact target and scope; reuse valid existing authorization where applicable. A generated `requires_approval: false` cannot bypass server policy. Payment, posting, and external contact still require their actual domain capability and authorization, not a concern-card flag. Say "I've queued the review" on queue acceptance, "the investigation has started" on worker claim, and "resolved" only after persisted supporting results.

The unattended AP loop and Devin concern coordinator are separate execution paths today. The coordinator is off by default, the Astra AP loop has no concern tools, and ordinary Devin workers cannot claim/resolve concerns under their current allowlist. Add a durable resolution dispatcher that consumes accepted decision jobs independently of the voice connection, reusing scoped investigation tasks for longer work. Persist the binding among decision, job, worker task, operation, and result. Do not assume that emitting `concern.responded` alone guarantees execution.

Demonstrate a real configured resolution consumer before claiming click-to-execution works. If it is paused, unavailable, or lacks an action capability, show the saved decision as waiting with the concrete reason. Do not silently start a new provider, relaunch duplicate work, or pretend a background worker picked it up. Closing the browser must not strand an accepted job. Duplicate deliveries and reclaimed leases resume the same decision using stable operation keys, persisted intent/receipts, and reconciliation of unknown external outcomes.

Restrict claim, renewal, and completion to the assigned scoped executor. Current concern HTTP claim/resolve endpoints only require workspace membership; tighten this before presenting their results as executed actions. Bind leases to decision/job and executor identity, fence stale workers at every mutating operation, and keep user selection separate from executor authority.

A cited self-report is insufficient proof that the selected operation happened. Require structured completion criteria and receipts: executed operation IDs, current evidence versions/hashes, resulting task/artifact/proposal IDs, deterministic domain outcomes where available, and remaining blockers or approvals. An investigation can finish while payment is still unexecuted. Narrate that distinction and keep unknown outcomes unconfirmed until reconciled. Never let a model-written summary alone mark a financial effect complete.

When the worker needs more input, create a new decision revision with the new evidence and three newly reviewed options. Do not reuse the old option mapping unchanged. Preserve prior decisions and outcomes in history. If Jev or drafting fails, keep the anomaly visible with a retry and custom-response path; do not fabricate approved choices or discard the concern. A custom instruction still goes through ordinary validation and authority checks, even when suggestion generation is unavailable.

Publish committed transitions for card readiness, response acceptance, execution claim, blocked input, resolution, and failure into the workflow journal. Preserve the existing `concern.responded` consumer event and make its identity stable. Link every narration to the concern and decision revision so stale suggestions or an old completion cannot overwrite a newer decision.

### Additional build and release gates

Extend phases 2 and 3 with versioned concern events, Jev-reviewed decision payloads, and the durable resolution dispatcher; extend phase 6 with the shared decision UI, voice intent binding, and execution receipts. This decision loop is part of the initial CFO demo, not a later decorative feature.

- Exactly three distinct reviewed options are shown and spoken from the same card revision, with optional typed/voice custom response.
- Click, typed directive, and committed voice choice produce equivalent authorized commands. Questions, negation, interim transcripts, and assistant speech never submit.
- Two open concerns, an alert arriving mid-speech, and regenerated options cannot misdirect numbered choices.
- Simultaneous clicks/voice, retry after lost response, and worker redelivery create one accepted decision and one logical execution.
- Stale revisions, changed evidence, expired membership, and missing capabilities fail before execution without losing the user's draft.
- A paused or missing consumer stays visibly queued. A worker crash resumes safely; an expired claimant cannot report completion.
- A member cannot forge executor completion. A disconnected browser does not stop the job; stale workers cannot mutate its domain records; a resolution without required operation receipts remains unverified.
- Jev failure preserves the concern and custom input. Invalid options are never presented as reviewed.
- A real sandbox run demonstrates escalation, all three suggestions, one selected choice, actual worker progress, and a cited outcome. A second run demonstrates custom voice/text input and a follow-up decision after new evidence.
- Captions cover the escalation, available actions, accepted instruction, and actual outcome. Routine commentary cannot replace a pending decision or speak a superseded option list.

This section extends the implementation plan. It does not claim the live CFO decision loop has been implemented or exercised.
