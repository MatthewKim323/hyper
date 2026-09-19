# Onboarding API: voice, typing, and streamed transcripts

Voice and typed messages use the same session, history, context, and Jev evaluator. The browser does not need microphone permission to type.

## Create a session

`POST /sessions`

```json
{"demo":true}
```

Response includes `session.id` and `token`. Keep the token private.

## Open the stream

Connect to `ws://127.0.0.1:8000/sessions/{id}/stream` (use `wss` under HTTPS). First send:

```json
{"token":"SESSION_TOKEN"}
```

The server returns a `session` event containing persisted history. This socket carries typed input, binary microphone audio, response audio, and transcript events.

## Type to the agent

```json
{"type":"text","id":"client-message-123","text":"Review this Friday's supplier invoices."}
```

Use a unique ID for each intentional message. Reusing an already recorded ID does not inject another turn. IDs must be 1–128 characters; text must be nonblank and at most 16,000 characters. Validation happens before starting a provider connection.

The backend uses Deepgram's `InjectUserMessage`; this is a real conversational turn, not merely a local transcript entry. Deepgram generates the reply. Voice and typing both require a working Deepgram connection.

## Receive live transcript segments

Both speakers produce the same event type:

```json
{
  "type":"transcript",
  "id":"segment-id",
  "sequence":2,
  "role":"assistant",
  "source":"agent",
  "text":"Which payment deadline should I use?",
  "created_at":"2026-09-19T19:00:00+00:00",
  "final":true,
  "generation":1
}
```

- `role`: `user` or `assistant`.
- `source`: `text` for typed input, `voice` for transcribed speech, `agent` for assistant output.
- `sequence`: monotonically increasing within the persisted session transcript, starting at 1.
- `id`: stable segment identifier for reconnect deduplication. Typed input retains the client message ID.
- `created_at`: server receipt time, not a word-level audio timestamp.
- `final`: this segment has been committed, **not** that the entire assistant response is complete. Multiple assistant segments can follow.
- `generation`: changes when interrupted; use it for playback handling.

Append segments as they arrive. Deepgram's `ConversationText` event drives the stream; no token-by-token or interim word stream is fabricated. Transcript text describes generated speech, not proof that the user heard it in full. Audio arrives separately as `audio` events. Ignore those if your client wants text-only output.

A `reply` event remains as a compatibility alias for assistant segments, using the **same ID**. Consume `transcript` for both roles; do not render both events or you will duplicate assistant text.

## Recover transcript history

`GET /sessions/{id}/transcript?after=0&limit=100`

Requires `Authorization: Bearer SESSION_TOKEN`.

```json
{
  "session_id":"session-id",
  "messages":[
    {"id":"client-message-123","sequence":1,"role":"user","source":"text","text":"Review this Friday's supplier invoices.","created_at":"2026-09-19T19:00:00+00:00"}
  ],
  "next_after":1,
  "has_more":false
}
```

Pass the last consumed sequence as `after` to retrieve subsequent segments. `limit` ranges from 1 to 500. Older sessions created before this metadata was added still receive sequence numbers; their entries may lack `source` and `created_at`.

For reconnect: authenticate the WebSocket, hydrate its `session.transcript`, and deduplicate subsequent events by ID. The GET endpoint is also available for history views without opening an active voice connection. HTTP endpoints are listed in FastAPI's `/docs`; this document defines the WebSocket protocol.

## Voice on the same socket

Send `{"type":"voice.start"}`. After `voice.ready`, stream binary signed little-endian mono PCM at 16 kHz. Send `{"type":"voice.stop"}` to stop microphone forwarding while keeping the conversation open for typing.

Other events include `context`, `readiness`, `status`, `error`, `interrupt`, and `connection.closed`. On `interrupt`, stop queued playback. On `connection.closed`, close/reopen the browser socket to resume saved history.

## Agent orb state

The backend emits `agent.state` on the existing session WebSocket:

```json
{"type":"agent.state","state":"researching","reason":"search_records","generation":2,"revision":1}
```

Map `state` to the frontend orb's existing visual presets. No LLM tool call is needed just to animate the orb: these events reflect actual runtime activity.

| State | Trigger |
| --- | --- |
| `idle` | Connected, or waiting with the microphone off |
| `listening` | Microphone enabled or user speech detected |
| `thinking` | Typed/voice turn submitted, Deepgram thinking, or readiness evaluation |
| `researching` | Record search tool executing |
| `speaking` | Provider audio arriving |
| `ready` | Jev confirms readiness for the scoped initial task |
| `error` | Provider unavailable/disconnected |

The agent chooses to search by calling `search_records`; the backend consequently emits `researching`. It cannot set `ready` by saying it is ready or by requesting an animation. Jev owns that decision.

**Browser playback takes precedence for speaking.** Incoming audio is not proof it is already playing. Set the visual to speaking when local playback starts. Deepgram's `AgentAudioDone` maps to `audio.done` with `generation` and `next_state`; wait until the local audio queue drains before applying that next state. Buffer other non-error state changes while playback continues. On `interrupt`, clear queued audio immediately and apply the new state. On disconnect, clear playback and use an error/disconnected visual. On microphone permission denial, send `voice.stop`.

Ignore audio/state events from outdated generations. Use the readiness event for a persistent completion indicator independent of the orb's transient speaking animation. Map unsupported visual states to the closest existing preset rather than assuming new shader modes exist. Audio amplitude/reaction should come from the browser's actual playback/microphone analyser, not LLM-generated numbers.

The actual orb component is maintained by a teammate and is not in this checkout; these are integration events, not a completed frontend orb hookup.
