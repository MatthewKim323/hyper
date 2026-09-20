"use client";

// Learned skills: procedures the agent wrote down after doing the work, with their tests and evidence.
// Agents draft them and report runs. Only an owner puts one into use or takes it out, and the owner's
// review is a statement they make themselves: the box is never ticked for them.
import { useRef, useState } from "react";
import { backend, BackendError } from "@/lib/backend/client";
import { SKILL_ATTESTATION, type SkillDetail, type SkillStatus, type SkillSummary } from "@/lib/backend/types";
import { useBackend } from "./useBackend";

const STATUS: Record<SkillStatus, { label: string; tone: string }> = {
  active: { label: "In use", tone: "ok" },
  draft: { label: "Draft", tone: "idle" },
  quarantined: { label: "Pulled", tone: "warn" },
  stale: { label: "Stale", tone: "warn" },
  retired: { label: "Retired", tone: "idle" },
};
const stamp = (value: number | string) => new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const denied = (reason: unknown, fallback: string) => reason instanceof BackendError && reason.status === 403 ? "Owner only" : (reason as Error).message || fallback;

function SkillReview({ skill, onChanged }: { skill: SkillDetail; onChanged: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<{ path: string; content: string } | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const run = skill.latest_run;
  const canActivate = ["draft", "quarantined"].includes(skill.status) && run?.outcome === "passed" && run.evidence_current && skill.evidence_current && skill.resources.some(path => path.startsWith("tests/"));
  const blocker = skill.status === "active" || skill.status === "retired" ? null
    : !run ? "No run yet"
    : run.outcome !== "passed" ? "Latest run failed"
    : !run.evidence_current || !skill.evidence_current ? "Evidence changed"
    : !skill.resources.some(path => path.startsWith("tests/")) ? "No tests" : null;

  async function act(work: () => Promise<unknown>, done: string) {
    if (sending.current) return;
    sending.current = true; setBusy(true); setNote(null);
    try { await work(); setNote({ ok: true, text: done }); onChanged(); }
    catch (cause) { setNote({ ok: false, text: denied(cause, "Failed") }); }
    finally { sending.current = false; setBusy(false); }
  }
  const open = (path: string) => void backend.skillResource(skill.id, path).then(setFile).catch(cause => setNote({ ok: false, text: denied(cause, "Unavailable") }));

  return <div className="ws-skill-review">
    <pre className="ws-skill-md">{skill.skill_md}</pre>
    {skill.resources.length > 0 && <div className="ws-skill-files"><span className="ws-eyebrow">Files</span>
      <ul>{skill.resources.map(path => <li key={path}><button type="button" className="ws-link" aria-pressed={file?.path === path} onClick={() => file?.path === path ? setFile(null) : open(path)}>{path}</button></li>)}</ul>
      {file && <pre className="ws-mono ws-skill-file" aria-label={file.path}>{file.content}</pre>}
    </div>}
    {skill.research_urls.length > 0 && <p className="ws-note">Cited: {skill.research_urls.map((url, index) => <span key={url}>{index > 0 && ", "}<a className="ws-link" href={url} target="_blank" rel="noreferrer">{new URL(url).hostname}</a></span>)}</p>}
    <section className="ws-skill-run" data-outcome={run?.outcome ?? "none"}>
      <span className="ws-eyebrow">Latest run · agent reported</span>
      {run ? <>
        <p><strong>{run.outcome === "passed" ? "Passed" : run.outcome === "failed" ? "Failed" : "Needs input"}</strong> · {stamp(run.created_at)}{run.duration_ms !== null ? ` · ${(run.duration_ms / 1000).toFixed(1)}s` : ""}</p>
        {run.summary && <p>{run.summary}</p>}
        <ul className="ws-checks">{run.checks.map((check, index) => <li key={index} data-ok={run.outcome === "passed"}>{check}</li>)}</ul>
      </> : <p className="ws-note">None</p>}
    </section>
    {blocker && <p className="ws-warning">{blocker}</p>}
    {canActivate && <div className="ws-skill-activate">
      <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={event => setReviewed(event.target.checked)} /><span>{SKILL_ATTESTATION}</span></label>
      <div className="ws-actions"><button type="button" disabled={!reviewed || busy} onClick={() => run && void act(() => backend.activateSkill(skill, run.run_id), "In use")}>Put into use</button></div>
    </div>}
    {skill.status === "active" && <form className="ws-inline" onSubmit={event => { event.preventDefault(); if (reason.trim().length >= 10) void act(() => backend.retireSkill(skill.id, reason.trim()), "Retired"); }}>
      <input value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} disabled={busy} placeholder="Reason" aria-label="Reason for retiring this skill" />
      <button type="submit" disabled={busy || reason.trim().length < 10}>Retire</button>
    </form>}
    {note && <p className={note.ok ? "ws-note" : "ws-warning"} role="status">{note.text}</p>}
  </div>;
}

function SkillRow({ skill, open, toggle, onChanged }: { skill: SkillSummary; open: boolean; toggle: () => void; onChanged: () => void }) {
  const detail = useBackend(() => backend.skill(skill.id), open, 10000);
  const status = STATUS[skill.status] ?? STATUS.draft;
  return <article className="ws-card ws-skill" data-tone={status.tone} data-pointable={`skill:${skill.id}`} data-pointable-label={`Learned skill ${skill.name} version ${skill.version}`}
    data-pointable-data={JSON.stringify({ status: skill.status, version: skill.version, evidence_current: skill.evidence_current })}>
    <header><span className="ws-chip"><i aria-hidden="true" />{status.label}</span><time>version {skill.version} · {stamp(skill.created_at)}</time></header>
    <h3>{skill.name.replaceAll("-", " ")}</h3>
    <p>{skill.description}</p>
    <button type="button" className="ws-link" aria-expanded={open} onClick={toggle}>{open ? "Close" : skill.status === "draft" || skill.status === "quarantined" ? "Review" : "Open"}</button>
    {open && (detail.data ? <SkillReview skill={detail.data} onChanged={() => { detail.refresh(); onChanged(); }} />
      : <p className={detail.error ? "ws-warning" : "ws-note"} role="status">{detail.error ?? "Loading…"}</p>)}
  </article>;
}

/** Everything the agent has learned for this organization, newest version of each first. */
export function LearnedSkills({ active }: { active: boolean }) {
  const { data, error, refresh } = useBackend(backend.skills, active, 8000);
  const [openId, setOpenId] = useState<string | null>(null);
  const skills = data?.skills ?? [];
  const order: SkillStatus[] = ["draft", "quarantined", "stale", "active", "retired"];
  const sorted = [...skills].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name) || b.version - a.version);
  const waiting = skills.filter(skill => skill.status === "draft" || skill.status === "quarantined").length;
  return <section className="ws-section" data-pointable="group:learned-skills" data-pointable-label="Learned skills">
    <span className="ws-eyebrow">Skills{skills.length ? ` · ${skills.filter(skill => skill.status === "active").length} in use${waiting ? ` · ${waiting} to review` : ""}` : ""}</span>
    {error && <p className="ws-warning" role="status">{error}</p>}
    {data && !skills.length && <p className="ws-empty">No skills yet</p>}
    <div className="ws-stack">{sorted.map(skill => <SkillRow key={skill.id} skill={skill} open={openId === skill.id} toggle={() => setOpenId(openId === skill.id ? null : skill.id)} onChanged={refresh} />)}</div>
  </section>;
}
