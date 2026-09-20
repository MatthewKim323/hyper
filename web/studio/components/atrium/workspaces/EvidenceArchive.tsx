"use client";

import { Evidence } from "@/components/workspace/sections";
import RelicDataWorkspace, { type RelicDataProps } from "./RelicDataWorkspace";

export default function EvidenceArchive(props: RelicDataProps) {
  return <RelicDataWorkspace {...props} subject="your evidence"><Evidence {...props} embedded /></RelicDataWorkspace>;
}
