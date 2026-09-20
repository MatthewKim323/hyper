"use client";

import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/components/workspace/useBackend";
import { openSignIn } from "@/lib/backend/auth";
import styles from "./RelicDataWorkspace.module.css";

export type RelicDataProps = { active: boolean; onMotion?: (state: { busy?: boolean; selectedIndex?: number }) => void };

export default function RelicDataWorkspace({ active, onMotion, children, subject }: RelicDataProps & { children: ReactNode; subject: string }) {
  const auth = useAuth();
  const usable = auth.ready && auth.signedIn;
  useEffect(() => { if (!usable || !active) onMotion?.({ busy: false, selectedIndex: 0 }); }, [active, usable, onMotion]);
  return <div className={styles.surface} inert={!active}>
    {!auth.ready ? <p className={styles.note} role="status">Loading…</p>
      : !usable ? <div className={styles.empty}>
        <h3>{auth.mode === "unconfigured" ? "Workspace not connected" : `Sign in to view ${subject}`}</h3>
        {auth.mode === "clerk" && <button type="button" onClick={() => void openSignIn()}>Sign in</button>}
      </div> : <div key={auth.scope}>{children}</div>}
  </div>;
}
