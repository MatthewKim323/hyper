# Onboarding implementation status

- [x] FastAPI session API, browser WebSocket protocol, and SQLite persistence.
- [x] Replace custom LLM loop and separate STT/TTS connections with Deepgram Voice Agent API.
- [x] Managed voice/text conversation, application tool dispatch, context updates, and history replay.
- [x] Independent Jev readiness service through Vercel AI SDK; full transcript input.
- [x] Cancellation, scoped record access, development console, and protocol tests.
- [ ] Live provider/microphone checks (credentials not configured).
- [ ] Calibrate readiness on complete/incomplete/conflicting transcripts.
- [ ] Product UI integration, production authentication/quotas, and execution handoff.

Decision: Deepgram managed conversation for simplicity. No Devin or additional agent harness in this version.
