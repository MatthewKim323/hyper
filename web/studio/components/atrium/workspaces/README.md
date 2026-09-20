# Relic workspaces

The AP, Benchmarks, and Wallet stations open inside the live atrium. `RelicExperience` places each screen relative to the selected relic and uses the camera's progress for a reversible reveal. `relic-parts.ts` articulates the existing Blender geometry: pages, seven cubes, and the wallet prism's facets. No additional Blender asset is required for those transformations.

## Data

- Accounts Payable reads the authenticated dataset catalog, financial rows, original sources, cases, tasks, and concerns. Source-linked investigations are identified as source-level associations. Totals preserve decimal precision and imported units; absent line items are not synthesized. Originals download through the authenticated source endpoint.
- Benchmarks reads `/benchmarks/benchmarks.json`. It excludes development and grader self-check results. Real systems without measurements remain unmeasured. Comparison status comes from recorded comparison provenance, not merely matching suite names. Version pages contain at most seven systems and feed the exact same normalized values to the seven physical cubes. Success uses an absolute scale; latency and cost share one scale across all pages in the selected suite. No sample export is loaded automatically.
- Wallet Identity reads the authenticated organization, read-only connections, controller status, and tasks. Browser-wallet connection implements EIP-1193 address/network visibility through an explicit user action. It does not verify ownership, change organization membership, sign messages, grant agent permissions, or submit transactions. Closing discards the local wallet display and unsubscribes provider events; permissions remain managed in the wallet itself.

Cached backend responses are scoped to the current Clerk session, user, and organization. Poll cancellation suppresses late results, and authorization failures clear cached data. Signing and payments are not backend capabilities and are not represented as available actions.

## Motion and interaction

Opening and closing preserve the current spring velocity. A new selection bends the existing camera path. Data poses stabilize once open; real in-flight work controls the illuminated material ribbon. Reduced motion snaps geometry and camera to stable poses. Responsive framing accounts for both horizontal and vertical canvas cropping. The full frame remains scrollable, and Escape/Back returns focus to the station.

Pedestals are excluded from hit areas because their projected bounds overlap adjacent stations. Station targets cover the floating icon, label, and arrow. Targets stay disabled while the camera is returning home so a moving target cannot select a different station.

## Verification

Run `bun test components/atrium lib/backend/poll.test.ts` from `web/studio`, then `bunx tsc --noEmit`. Motion and camera tests use the shipped GLBs. Wallet tests cover provider events and late promises without a wallet extension or credentials. AP contract tests additionally use `backend/.venv/bin/python` when available to exercise the actual FastAPI authentication, parser, query, source, and connector routes against isolated temporary storage. They do not mutate the running backend.
