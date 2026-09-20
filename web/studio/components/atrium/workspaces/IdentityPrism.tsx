"use client";

import ActivityOrb from "@/components/ui/ActivityOrb";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BackendError, backend } from "@/lib/backend/client";
import type { Connection, ProviderInfo } from "@/lib/backend/types";
import { openSignIn } from "@/lib/backend/auth";
import { useAuth, useBackend, when } from "@/components/workspace/useBackend";
import { browserWallet, chainLabel, createWalletSession, EMPTY_WALLET, type WalletState } from "./browser-wallet";
import styles from "./IdentityPrism.module.css";

type Props = { active: boolean; onMotion?: (state: { busy?: boolean; selectedIndex?: number }) => void };
const facets = ["Sources", "Permissions", "Identity"] as const;

// What each source gives the agent. Only providers the backend actually implements are listed.
const SOURCES: { id: string; name: string; reads: string }[] = [
  { id: "gmail", name: "Gmail", reads: "Supplier emails and their attachments" },
  { id: "drive", name: "Google Drive", reads: "Contracts, agreements and spreadsheets" },
  { id: "ramp", name: "Ramp", reads: "Bills and card transactions" },
  { id: "plaid", name: "Bank (Plaid)", reads: "Bank transactions" },
];
const LIVE = new Set(["connected", "authorizing"]);
const STATUS: Record<string, string> = { connected: "Connected", authorizing: "Waiting for consent", reauth_required: "Needs sign-in again", error: "Sync failed", authorization_failed: "Consent failed", disconnected: "Disconnected" };

function SourceTile({ source, info, connection, onChanged }: { source: typeof SOURCES[number]; info?: ProviderInfo; connection?: Connection; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [form, setForm] = useState(false);
  const live = !!connection && LIVE.has(connection.status);
  // Ramp takes its credentials per connection; the others need the server to hold a client first.
  const unavailable = source.id !== "ramp" && !!info && !info.configured;
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setNote("");
    try { await work(); onChanged(); }
    catch (reason) {
      const message = (reason as Error).message;
      // The server names its missing settings; that is for whoever runs it, not for this screen.
      setNote(reason instanceof BackendError && (reason.status === 503 || /^Missing server configuration/i.test(message)) ? "Not set up on the server." : message);
    }
    finally { setBusy(false); }
  };
  const connect = () => {
    if (source.id === "ramp") { setForm(true); return; }
    if (source.id === "plaid") { setNote("Bank linking unavailable."); return; }
    // The window must open inside the click, before any await, or the browser blocks it.
    const popup = window.open("about:blank", "hyper-connect", "width=520,height=680");
    void run(async () => {
      const { authorization_url } = await backend.authorizeGoogle(source.id as "gmail" | "drive");
      if (popup) popup.location.href = authorization_url; else window.location.href = authorization_url;
    }).then(() => { if (!popup) return; const watch = setInterval(() => { onChanged(); if (popup.closed) clearInterval(watch); }, 2500); });
  };
  const submitRamp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void run(async () => {
      await backend.connectRamp({ client_id: String(data.get("client_id")), client_secret: String(data.get("client_secret")), environment: data.get("environment") === "production" ? "production" : "sandbox" });
      setForm(false);
    });
  };
  return <li className={styles.source} data-live={live || undefined}>
    <div className={styles.row}><h4>{source.name}</h4><ActivityOrb status={busy ? "working" : connection?.status ?? "disconnected"} label={busy ? "Updating source" : connection ? STATUS[connection.status] ?? connection.status : unavailable ? "Unavailable" : "Not connected"} /></div>
    <p>Read only</p>
    {connection?.last_synced_at ? <p className={styles.note}>Last read {when(connection.last_synced_at)}</p> : live && <p className={styles.note}>Starting…</p>}
    {connection?.error && <p className={styles.note} role="status">{connection.error}</p>}
    {form && <form className={styles.credentials} onSubmit={submitRamp}>
      <input name="client_id" required autoComplete="off" placeholder="Client ID" aria-label="Ramp client ID" />
      <input name="client_secret" required type="password" autoComplete="off" placeholder="Client secret" aria-label="Ramp client secret" />
      <select name="environment" aria-label="Ramp environment" defaultValue="sandbox"><option value="sandbox">Sandbox</option><option value="production">Production</option></select>
      <div className={styles.actions}><button type="submit" className={styles.action} disabled={busy}>{busy ? "Connecting…" : "Connect Ramp"}</button><button type="button" className={styles.textButton} onClick={() => setForm(false)}>Cancel</button></div>
    </form>}
    {!form && <div className={styles.actions}>
      {live ? <><button type="button" className={styles.action} disabled={busy} onClick={() => void run(() => backend.syncConnection(connection!.id))}>{busy ? "Reading…" : "Read now"}</button>
        <button type="button" className={styles.textButton} disabled={busy} onClick={() => void run(() => backend.disconnect(connection!.id))}>Disconnect</button></>
        : <button type="button" className={styles.action} disabled={busy || unavailable} onClick={connect}>{busy ? "Opening…" : connection ? "Reconnect" : "Connect"}</button>}
    </div>}
    {note && <p className={styles.note} role="status">{note}</p>}
  </li>;
}

export default function IdentityPrism({ active, onMotion }: Props) {
  const auth = useAuth();
  const usable = auth.ready && auth.signedIn;
  const enabled = active && usable;
  const workspace = useBackend(backend.workspace, enabled, 15000);
  const controller = useBackend(backend.controller, enabled);
  const connections = useBackend(backend.connections, enabled, 5000);
  const providers = useBackend(backend.providers, enabled, 60000);
  const sources = useBackend(() => backend.sources(1), enabled, 8000);
  const [facet, setFacet] = useState(0);
  const [wallet, setWallet] = useState<WalletState>(EMPTY_WALLET);
  const [walletNote, setWalletNote] = useState("");
  const [copied, setCopied] = useState(false);
  const session = useRef<ReturnType<typeof createWalletSession> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { session.current?.dispose(); if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  useEffect(() => { if (!active) { session.current?.hide(); session.current?.dispose(); session.current = null; } }, [active]);
  useEffect(() => {
    onMotion?.({ busy: wallet.pending || (enabled && controller.data?.status === "running"), selectedIndex: facet });
  }, [wallet.pending, enabled, controller.data?.status, facet, onMotion]);

  function connect() {
    const provider = browserWallet();
    if (!provider) { setWalletNote("No wallet extension found."); return; }
    setWalletNote("");
    session.current ??= createWalletSession(provider, setWallet);
    void session.current.connect();
  }
  async function copyAddress() {
    if (!wallet.address) return;
    try { await navigator.clipboard.writeText(wallet.address); setCopied(true); if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 1600); }
    catch { setWalletNote("Copy unavailable."); }
  }
    const org = usable ? workspace.data?.organization : null;
  return <div className={styles.prism}>
    <div className={styles.tabs} role="tablist" aria-label="Access facets">
      {facets.map((label, index) => <button key={label} type="button" role="tab" id={`identity-facet-${index}`} aria-controls={`identity-panel-${index}`} aria-selected={facet === index} tabIndex={facet === index ? 0 : -1}
        onClick={() => setFacet(index)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : (facet + (event.key === "ArrowRight" ? 1 : 2)) % 3;
          setFacet(next); document.getElementById(`identity-facet-${next}`)?.focus();
        }}>{label}</button>)}
    </div>
    <div className={styles.panel} role="tabpanel" id={`identity-panel-${facet}`} aria-labelledby={`identity-facet-${facet}`} tabIndex={0}>
      {facet === 0 && <>
        <section>
          <h3>Connect a source</h3>
          {!usable ? <><p>Sign in to view</p>{auth.ready && auth.mode === "clerk" && <button className={styles.action} type="button" onClick={() => void openSignIn()}>Sign in</button>}</>
            : connections.error ? <p role="status">Sources couldn&rsquo;t be loaded. <button type="button" className={styles.textButton} onClick={connections.refresh}>Try again</button></p>
            : <ul className={styles.sources}>{SOURCES.map(source => <SourceTile key={source.id} source={source}
                info={providers.data?.providers.find(item => item.id === source.id)}
                connection={connections.data?.connections.filter(item => item.provider === source.id).sort((x, y) => Number(LIVE.has(y.status)) - Number(LIVE.has(x.status)) || y.created_at - x.created_at)[0]}
                onChanged={() => { connections.refresh(); sources.refresh(); }} />)}</ul>}
          {usable && sources.data && <p className={styles.note}>{sources.data.sources.length ? `Latest evidence filed ${when(sources.data.sources[0].created_at)}: ${sources.data.sources[0].filename}.` : "No evidence yet"}</p>}
        </section>
      </>}
      {facet === 1 && <>
        <section><h3>Agent permissions</h3>
          <ul className={styles.permissions}><li><i />Read connected evidence <span>Available</span></li><li><i />Investigate and prepare findings <span>Available</span></li><li><i />Request a human decision <span>Available</span></li><li data-unavailable><i />Move funds or sign transactions <span>Unavailable</span></li><li data-unavailable><i />Change access permissions <span>Unavailable</span></li></ul>
        </section>
      </>}
      {facet === 2 && <>
        <section className={styles.identity}>
          <h3>{org?.name ?? (usable ? "Loading workspace…" : "Workspace")}</h3>
          {org ? <><p className={styles.note}>{org.onboarding_complete ? "Onboarding complete." : "Onboarding in progress."}</p><details className={styles.details}><summary>Workspace details</summary><dl><div><dt>Organization ID</dt><dd>{org.id}</dd></div><div><dt>Member ID</dt><dd>{workspace.data?.user_id}</dd></div></dl></details></>
            : <p>{!auth.ready ? "Loading…" : usable ? workspace.error ?? "Loading…" : auth.mode === "unconfigured" ? "Sign-in unavailable" : "Sign in to view"}</p>}
          {!usable && auth.ready && auth.mode === "clerk" && <button className={styles.action} type="button" onClick={() => void openSignIn()}>Sign in</button>}
          {usable && workspace.error && <button type="button" className={styles.action} onClick={workspace.refresh}>Try again</button>}
        </section>
        <section className={styles.wallet}>
          <div className={styles.row}>{wallet.address && <span className={styles.badge}>Address shared</span>}</div>
          {wallet.address ? <><p className={styles.address}>{wallet.address}</p><p>{chainLabel(wallet.chain)}</p><div className={styles.actions}><button type="button" className={styles.action} onClick={() => void copyAddress()}>{copied ? "Copied" : "Copy address"}</button><button type="button" onClick={() => { session.current?.hide(); setWallet(EMPTY_WALLET); setCopied(false); }} className={styles.textButton}>Hide address</button></div></>
            : <><h4>No wallet connected</h4><button type="button" className={styles.action} disabled={wallet.pending} onClick={connect}>{wallet.pending ? "Waiting…" : "Connect wallet"}</button></>}
          {(wallet.error || walletNote) && <p className={styles.note} role="status">{wallet.error || walletNote}</p>}
        </section>
      </>}
    </div>
  </div>;
}
