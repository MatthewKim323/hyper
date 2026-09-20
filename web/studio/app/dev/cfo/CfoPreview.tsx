"use client";

import { useEffect, useState } from "react";
import CfoPanel from "@/components/command/CfoPanel";

/** Actual authenticated feed only. The preview never starts voice or worker sessions. */
export default function CfoPreview() {
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  useEffect(() => {
    const toggle = (event: Event) => {
      setInstant(!!(event as CustomEvent<{ keyboard?: boolean }>).detail?.keyboard);
      setOpen(value => !value);
    };
    window.addEventListener("hyper:cfo-toggle", toggle);
    return () => window.removeEventListener("hyper:cfo-toggle", toggle);
  }, []);
  return <CfoPanel open={open} instant={instant} onOpenChange={setOpen} />;
}
