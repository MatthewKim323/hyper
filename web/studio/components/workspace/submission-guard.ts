/** A synchronous gate also covers two clicks before React commits its disabled state. */
export function createSubmissionGuard() {
  let inFlight = false;
  return {
    async run<T>(submit: () => Promise<T>): Promise<{ submitted: false } | { submitted: true; value: T }> {
      if (inFlight) return { submitted: false };
      inFlight = true;
      try { return { submitted: true, value: await submit() }; }
      finally { inFlight = false; }
    },
  };
}
