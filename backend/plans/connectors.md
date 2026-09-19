# Real read-only connectors

## Outcome
Authenticated organization members can authorize Gmail/Drive, connect Ramp business credentials, and connect Plaid Items via Link. A durable worker imports real source records and documents into the existing S3/Postgres/Elastic pipeline. Missing credentials are reported, never substituted with simulated data.

## Plan
1. Add encrypted connection credentials, expiring one-use authorization state, source item mapping, sync cursors and leased background scheduling.
2. Google: authorization-code flow with PKCE/offline tokens, Gmail message history/attachments, Drive file changes/downloads/native exports.
3. Ramp: business-owned client credentials, token refresh, paginated bills and card transactions. Multi-customer partner OAuth is outside this first version.
4. Plaid: create Link token, exchange public token, transactions/sync with full pagination restart on mutation, additions/modifications/removals and exact decimal amounts.
5. Expose providers/configuration status, authorize/exchange, list/detail/sync/disconnect, imported items and private original downloads. Keep read credentials out of API responses/logs and organization identity server-derived.
6. Verify provider request/response contracts using HTTP mocks, authorization isolation, token expiry/state replay, cursor failure recovery, pagination, removals, repeat imports and disconnect races. Live account checks require user/provider credentials.

## Decisions
- Polling with durable cursors; no unauthenticated webhook that can trigger imports. Default five-minute interval, worker runs separately.
- First provider authorization queues initial sync. HTTP connection endpoints never perform entire imports.
- Disconnect deactivates imported sources, clears stored credentials, and stops new work. Originals remain accessible for audit; revoke app grants in the provider dashboard separately.
- Tokens encrypted with operator-managed CONNECTOR_ENCRYPTION_KEY; no automatic ephemeral key. Account-level duplicate connections rejected while active.
- Raw bytes retained separately from parsed evidence; unsupported/oversized formats are surfaced per item. No silent claims that binary documents are searchable.
- Google restricted scopes/production verification and Ramp/Plaid production access are provider prerequisites, not implemented by this code.

## Primary references
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/workspace/gmail/api/guides/sync
- https://developers.google.com/workspace/drive/api/guides/manage-changes
- https://docs.ramp.com/llms-api.txt
- https://support.ramp.com/accessing-the-developer-api
- https://plaid.com/docs/api/link/
- https://plaid.com/docs/api/products/transactions/

## Completed verification
- Implemented four real provider adapters, Google PKCE/offline consent, Ramp business-client authentication, Plaid Link/exchange, encrypted credentials, durable scoped polling, item originals, sync control and disconnect.
- Fifteen connector tests pass with mocked provider HTTP, including state replay/member removal, pagination mutation, pending replacement, token refresh, workbook tabs, failure recovery, rate limits, stale leases and cross-organization access.
- Full backend suite: 71 passed; three opt-in storage tests run separately and passed against real Postgres/S3/Elasticsearch (provider HTTP remains mocked).
- Local API and connector worker started. OpenAPI exposes all connector routes; unauthenticated listing returns 401.
- Persistent encryption key configured in ignored local .env without logging it. Google/Plaid/Clerk credentials remain missing; Ramp credentials must be supplied by a business admin. No live provider-account verification or frontend connection UI is claimed.
