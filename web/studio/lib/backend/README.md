# Backend client

`client.ts` is the typed client for `backend/`, `types.ts` mirrors its response shapes, and `auth.ts` supplies the bearer token. The backend accepts Clerk session JWTs only and has no development bypass.

| Setting (Next env) | Effect |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Real sign-in through Clerk. The backend needs the matching `CLERK_ISSUER` and this site's origin in `CLERK_AUTHORIZED_PARTIES` |
| `NEXT_PUBLIC_BACKEND_DEV_TOKEN` | Fixed token for the keyless local backend below. Ignored in production builds |
| neither | Sections show a notice explaining sign-in is not set up. Voice onboarding falls back to the old anonymous protocol, which only a pre-sign-in backend accepts |

Nothing is pushed from the server. Screens poll with `poll()` / `useBackend()`, skip while the tab is hidden, back off on errors and stop on 401.

## Keyless local backend

`tools/dev_backend.py` runs the real `backend/app` with stand-ins for sign-in, object storage, search and the concern-card model, then seeds a small Meridian workspace (sources, three concerns in different states, three cases, a task, simulated activity). Seeded text is labelled DEV_FIXTURE and is not evidence that an agent did anything.

```sh
# terminal 1, from the repo root
uv run --directory backend python ../web/studio/tools/dev_backend.py

# terminal 2, from web/studio: a second dev server so the main one is untouched
NEXT_DIST_DIR=.next-dev-backend ONBOARDING_BACKEND_URL=http://127.0.0.1:8010 \
NEXT_PUBLIC_BACKEND_DEV_TOKEN=dev-local-only NEXT_PUBLIC_ONBOARDING_WS_URL=ws://127.0.0.1:8010 \
bunx next dev -p 3889
```

It binds to 127.0.0.1, resets its SQLite file on every start and must never be deployed.
