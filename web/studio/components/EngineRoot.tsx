"use client";

// Boots the imperative WebGL engine once on mount. React never re-renders engine DOM.
// Ensures the #gl canvas (fixed z-40 wrapper) and the .height-div helper exist even if the
// Shell markup has not rendered them; the CSS3D layer is appended to <body> by Gl itself.
import { useEffect } from "react";

let started = false;

function ensureEngineDom() {
  if (!document.getElementById("gl")) {
    const wrap = document.createElement("div");
    wrap.className = "fixed fill w-1/1 h-1/1 z-40 user-select-none pointer-events-none";
    const canvas = document.createElement("canvas");
    canvas.id = "gl";
    wrap.appendChild(canvas);
    document.body.appendChild(wrap);
  }
  if (!document.querySelector(".height-div")) {
    const div = document.createElement("div");
    div.className = "height-div";
    document.body.appendChild(div);
  }
}

export default function EngineRoot() {
  useEffect(() => {
    if (started) return;
    started = true;
    ensureEngineDom();
    import("@/lib/engine/boot")
      .then((m) => m.bootEngine())
      .catch((err) => console.error("[engine] boot failed", err));
  }, []);
  return null;
}
