"use client";

import { useEffect, useRef, useState } from "react";
import { backend } from "@/lib/backend/client";
import { openSignIn } from "@/lib/backend/auth";
import { useAuth, useBackend, when } from "@/components/workspace/useBackend";
import { browserWallet, chainLabel, createWalletSession, EMPTY_WALLET, type WalletState } from "./browser-wallet";
import styles from "./IdentityPrism.module.css";

type Props = { active: boolean; onMotion?: (state: { busy?: boolean; selectedIndex?: number }) => void };
const facets = ["Identity", "Access", "Activity"] as const;

export default function IdentityPrism({ active, onMotion }: Props) {
  const auth = useAuth();
  const usable = auth.ready && auth.signedIn;
  const enabled = active && usable;
  const workspace = useBackend(backend.workspace, enabled, 15000);
  const controller = useBackend(backend.controller, enabled);
  const tasks = useBackend(backend.tasks, enabled);
  const connections = useBackend(backend.connections, enabled, 15000);
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
    if (!provider) { setWalletNote("Open Hyper in a browser with an Ethereum wallet extension, then try again."); return; }
    setWalletNote("");
    session.current ??= createWalletSession(provider, setWallet);
    void session.current.connect();
  }
  async function copyAddress() {
    if (!wallet.address) return;
    try { await navigator.clipboard.writeText(wallet.address); setCopied(true); if (copyTimer.current) clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(false), 1600); }
    catch { setWalletNote("Copy isn’t available in this browser. Select the address to copy it."); }
  }
  const refresh = () => { workspace.refresh(); controller.refresh(); tasks.refresh(); connections.refresh(); };
  const org = usable ? workspace.data?.organization : null;
  return <div className={styles.prism}>
    <div className={styles.tabs} role="tablist" aria-label="Identity facets">
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
        <section className={styles.identity}>
          <span className={styles.eyebrow}>Your workspace</span>
          <h3>{org?.name ?? (usable ? "Loading workspace…" : "Workspace")}</h3>
          {org ? <><p className={styles.note}>{org.onboarding_complete ? "Onboarding complete." : "Onboarding in progress."}</p><details className={styles.details}><summary>Workspace details</summary><dl><div><dt>Organization ID</dt><dd>{org.id}</dd></div><div><dt>Member ID</dt><dd>{workspace.data?.user_id}</dd></div></dl></details></>
            : <p>{!auth.ready ? "Checking your sign-in…" : usable ? workspace.error ?? "Retrieving your organization." : auth.mode === "unconfigured" ? "Workspace sign-in is not available yet." : "Sign in to see your workspace."}</p>}
          {!usable && auth.ready && auth.mode === "clerk" && <button className={styles.action} type="button" onClick={() => void openSignIn()}>Sign in</button>}
          {usable && workspace.error && <button type="button" className={styles.action} onClick={workspace.refresh}>Try again</button>}
        </section>
        <section className={styles.wallet}>
          <div className={styles.row}><span className={styles.eyebrow}>Browser wallet</span>{wallet.address && <span className={styles.badge}>Address shared</span>}</div>
          {wallet.address ? <><p className={styles.address}>{wallet.address}</p><p>{chainLabel(wallet.chain)}</p><div className={styles.actions}><button type="button" className={styles.action} onClick={() => void copyAddress()}>{copied ? "Copied" : "Copy address"}</button><button type="button" onClick={() => { session.current?.hide(); setWallet(EMPTY_WALLET); setCopied(false); }} className={styles.textButton}>Hide address</button></div><p className={styles.note}>Address shared with this page. Manage site permissions in your wallet.</p></>
            : <><h4>No wallet connected</h4><p>Optional. Connect to view your address and network.</p><button type="button" className={styles.action} disabled={wallet.pending} onClick={connect}>{wallet.pending ? "Waiting for your wallet…" : "Connect wallet"}</button></>}
          {(wallet.error || walletNote) && <p className={styles.note} role="status">{wallet.error || walletNote}</p>}
        </section>
      </>}
      {facet === 1 && <>
        <section><h3>Agent permissions</h3><p>The agent can investigate connected records and request your review.</p>
          <ul className={styles.permissions}><li><i />Read connected evidence <span>Available</span></li><li><i />Investigate and prepare findings <span>Available</span></li><li><i />Request a human decision <span>Available</span></li><li data-unavailable><i />Move funds or sign transactions <span>Unavailable</span></li><li data-unavailable><i />Change access permissions <span>Unavailable</span></li></ul>
          <p className={styles.note}>Wallet access is limited to your address and network.</p>
        </section>
        <section><div className={styles.row}><span className={styles.eyebrow}>Connected sources</span>{usable && <button type="button" className={styles.textButton} onClick={connections.refresh}>Refresh</button>}</div>
          {!usable ? <p>Sign in to see your organization’s connections.</p> : connections.error ? <p role="status">Connections couldn’t be loaded. Try refreshing.</p> : !connections.data ? <p>Loading connected sources…</p> : connections.data.connections.length ? <ul className={styles.connections}>{connections.data.connections.map(connection => <li key={connection.id}><div><strong>{connection.label}</strong><span>{connection.provider} · {connection.status.replaceAll("_", " ")}</span></div><small>{connection.last_synced_at ? `Synced ${when(connection.last_synced_at)}` : "Not synced yet"}</small></li>)}</ul> : <p>No sources connected yet.</p>}
          {usable && connections.data?.has_more && <p className={styles.note}>Showing the first 50 connections.</p>}
        </section>
      </>}
      {facet === 2 && <>
        <section><div className={styles.row}><h3>Agent activity</h3>{usable && <button type="button" className={styles.textButton} onClick={refresh}>Refresh</button>}</div>
          {!usable ? <p>Sign in to see agent activity in your workspace.</p> : <><p>{controller.error ? "Controller status couldn’t be loaded." : controller.data ? `Controller ${controller.data.enabled ? "enabled" : "paused"}. Status: ${controller.data.status.replaceAll("_", " ")}.` : "Checking controller status…"}</p>
            {tasks.error ? <p role="status">Agent tasks couldn’t be loaded. Try refreshing.</p> : !tasks.data ? <p>Loading tasks…</p> : !tasks.data.tasks.length ? <p className={styles.empty}>No agent tasks recorded yet.</p> : <ol className={styles.tasks}>{tasks.data.tasks.map(task => <li key={task.id}><span className={styles.badge}>{task.status.replaceAll("_", " ")}</span><strong>{task.objective}</strong>{task.result?.summary && <p>{task.result.summary}</p>}{task.error && <p role="status">{task.error}</p>}</li>)}</ol>}
            {tasks.data?.has_more && <p className={styles.note}>Showing the first 50 tasks.</p>}</>}
        </section>
      </>}
    </div>
  </div>;
}
