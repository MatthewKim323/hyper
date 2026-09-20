# Relic workspaces

All six stations open inside the live atrium. `experience-config.ts` shares their framing rules between the renderer and camera tests. `RelicExperience` places transparent content beside or below the selected relic and uses the camera's progress for a reversible reveal. `relic-parts.ts` articulates the existing Blender geometry: pages, cubes, wallet facets, and approval rings. No additional Blender asset is required for those transformations.

## Data

- Accounts Payable reads the authenticated dataset catalog, financial rows, original sources, cases, tasks, and concerns. Source-linked investigations are identified as source-level associations. Totals preserve decimal precision and imported units; absent line items are not synthesized. Originals download through the authenticated source endpoint.
- Benchmarks reads `/benchmarks/benchmarks.json`. It excludes development and grader self-check results. Real systems without measurements remain unmeasured. Comparison status comes from recorded comparison provenance, not merely matching suite names. Version pages contain at most seven systems and feed the exact same normalized values to the seven physical cubes. Success uses an absolute scale; latency and cost share one scale across all pages in the selected suite. No sample export is loaded automatically.
- Wallet Identity reads the authenticated organization, read-only connections, controller status, and tasks. Browser-wallet connection implements EIP-1193 address/network visibility through an explicit user action. It does not verify ownership, change organization membership, sign messages, grant agent permissions, or submit transactions. Closing discards the local wallet display and unsubscribes provider events; permissions remain managed in the wallet itself.

- Audit & Evidence reuses authenticated evidence search and the source reader, with paginated original passages and authenticated downloads. The three sheets fan open and bring the selected source's visual slot forward.
- Training Arena embeds the real framework timeline, including source snapshots, imported recordings, and strict baseline/candidate comparisons. Source-only snapshots remain unmeasured. Its seven equal-size cubes form a chronological arc; selection cycles through physical slots without limiting history or implying performance scores.
- Approvals reuses the existing review workflow and its backend decision routes. Paired rings separate and counter-rotate on opening. Busy motion follows actual processing or pending requests. Decision submissions and card retries have synchronous guards against duplicate clicks.

Cached backend responses are scoped to the current Clerk session, user, and organization. Poll cancellation suppresses late results, and authorization failures clear cached data. Signing and payments are not backend capabilities and are not represented as available actions.

## Motion and interaction

Opening and closing preserve the current spring velocity. A new selection bends the existing camera path. Data poses stabilize once open; real in-flight work controls the illuminated material ribbon. The scene and water keep rendering while any relic workspace is open. Reduced motion snaps geometry and camera to stable poses. Responsive framing accounts for both horizontal and vertical canvas cropping. Content remains scrollable, and Escape/Back returns focus to the station.

Pedestals are excluded from hit areas because their projected bounds overlap adjacent stations. Station targets cover the floating icon, label, and arrow. Targets stay disabled while the camera is returning home so a moving target cannot select a different station.

## Verification

Run `bun test components/atrium lib/timeline lib/backend/poll.test.ts components/workspace/submission-guard.test.ts` from `web/studio`, then `bunx tsc --noEmit`. Motion and camera tests use the shipped GLBs. Wallet tests cover provider events and late promises without a wallet extension or credentials. AP contract tests additionally use `backend/.venv/bin/python` when available to exercise the actual FastAPI authentication, parser, query, source, and connector routes against isolated temporary storage. They do not mutate the running backend.
