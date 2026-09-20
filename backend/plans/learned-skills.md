# Learned Accounting Skills

## Implemented lifecycle
Discover → load relevant instructions → load selected resources → research/implement/execute in the existing Devin workspace → save logs → save immutable draft → record execution → owner reviews evidence and activates → retrieve on a similar task.

This is procedural memory and reusable software, not model-weight training. The backend stores, retrieves and governs packages; Devin performs research and code execution. It never executes uploaded skill code inside FastAPI.

## Design
- Organization-scoped PostgreSQL metadata, immutable versions and package hashes; S3-compatible package storage.
- Agent Skills-compatible SKILL.md generated from concise description, instructions, applicability and limitations. Separate scripts/, tests/, references/ and assets/ text resources load on demand.
- Summary-only Elasticsearch indexing using the existing inference configuration; organization/version/status/freshness are always checked against SQL. Keyword catalogue fallback works without Elasticsearch. Activation can be retried to reindex.
- Optimistic based_on_version for revisions; identical latest package saves are idempotent. Run reports have independent request keys and content checks.
- Source hashes bind assumptions to evidence. Superseded sources remove skills from default discovery. An explicit inactive/history search supports inspection and revision.
- Owner activation binds an exact package hash and latest passing execution evidence. A tests resource is required. A self-reported pass is not independent verification: the owner explicitly attests review of the actual tests, accounting assumptions and evidence.
- Failure reports quarantine active versions immediately. Reuse can resume only after latest passing evidence and renewed owner review. Retired versions remain inspectable, not discoverable by default.
- Existing concern cards collect missing policy/evidence decisions. Skills cannot approve journals, change roles or grant new execution permissions.

## Scope and limits
No autonomous accounting-policy activation, provider-wide company knowledge, arbitrary server shell execution, hidden benchmark answers, or automatic training-score claim. Worker reports are labelled self_reported and their execution evidence is labelled agent-reported. Resource integrity is checked before loading. Owner review is the independent promotion gate; the backend does not claim it independently executed tests. Success counts and durations are reported observations, not causal proof of improvement.

No new scheduler or agent harness is introduced. Existing persistent Devin tasks receive the skill lifecycle instructions and tools. Real tasks must supply source evidence and run code in their isolated workspace. Native repo skills are not used for private company packages because Devin can discover connected-repo skills broadly. These packages stay scoped to a single application organization.

## Verification
Tenant/owner boundaries, progressive disclosure, immutable revisions, idempotent reports, stale evidence, package tampering, safe resource paths, activation checks, failure quarantine and SQL fallback are covered by tests. A PostgreSQL lifecycle smoke test covers persistence.

## Research
- https://docs.devin.ai/product-guides/skills
- https://agentskills.io/specification
- https://arxiv.org/abs/2305.16291

## Benchmark sequencing
After this layer: BenchRec, DABstep, APEX. Freeze learned packages before evaluation; keep learning cases and held-out evaluation separate. Compare equivalent agent configurations with and without skills, preserving failures and denominators. The existing Invoice Sandbox result remains an isolated worker baseline, not evidence of skill-mediated improvement.
