# Skill Extraction API

Clerk authentication and organization isolation apply to every route. Extraction
turns a completed agent task or case into an evidence-bound draft learned skill
with recorded lineage. Activation still requires the existing owner review in
`SKILLS_API.md`; extraction never activates anything.

| Route | Purpose |
| --- | --- |
| `POST /accounting/skills/extract/task` | Draft a skill package from a completed agent task. |
| `POST /accounting/skills/extract/case` | Draft a skill package from a completed agent case. |
| `GET /accounting/skills/lineage/{skill_id}` | Read extraction lineage rows for a skill. |

Agent tools: `draft_skill_from_task`, `draft_skill_from_case`, `get_skill_lineage`.

Extraction requires: a completed origin (task status `complete`; a case needs
nonempty findings and empty next actions), at least one active evidence source
(collected from the task/case state plus an optional explicit `evidence_source_ids`
argument), and at least one `tests/` resource so the draft can ever satisfy the
activation gate. An unverifiable skill is rejected rather than saved.

The draft is saved through the ordinary `save_learned_skill` path with
`based_on_version` resolved against the latest saved version; a name conflict
surfaces the standard version error. Each call persists a `skill_extractions` row
recording `origin {kind, ref_id}`, provenance counts, and the evidence set.
`request_key` is idempotent: same key and arguments return the same extraction and
draft summary; same key with different arguments is a conflict.
