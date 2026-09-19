# Implementation review and corrections

The preliminary Luna engine was not accepted. Inspection found independently maintained balances that mixed future payments into earlier periods, incorrectly signed depreciation, incomplete asset schedules, placeholder bank movements and insufficient fixtures. The integrated generator in `data/engine` replaces that draft. The rejected draft remains only in ignored developer process logs/workspace, not the delivered generator or source export.

An independent read-only `codex exec` Luna review of the replacement identified validator gaps around settlement source identity, source/journal dates and missing statement periods. These were fixed and covered by mutation tests. The reviewer could not run tests in its read-only workspace; the primary process ran the tests in the writable project and reported their actual outcomes.

One review suggestion was rejected: two imported documents representing the same economic invoice do not necessarily require escalation. In the duplicate-import fixture, document IDs differ, but invoice identity, content hash and amount agree. The intended valid outcome is one deduplicated obligation and one authorized payment proposal. A regression test explicitly checks that the two documents represent the same invoice. A conflicting duplicate would require investigation and is not implied by an identical reimport.

Financial checks establish internal consistency of this synthetic dataset, not authenticity or accounting compliance of real-world source documents. Narrative drafts receive structural/source-reference validation, not a claim that another independent accountant approved every sentence.
