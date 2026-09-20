"use client";

import { Review } from "@/components/workspace/sections";
import RelicDataWorkspace, { type RelicDataProps } from "./RelicDataWorkspace";

export default function ApprovalsReview(props: RelicDataProps) {
  return <RelicDataWorkspace {...props} subject="your decisions"><Review {...props} embedded /></RelicDataWorkspace>;
}
