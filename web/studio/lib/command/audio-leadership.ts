type Options = {
  locks?: Pick<LockManager, "request">;
  name: string;
  visible: () => boolean;
  onChange: (leader: boolean) => void;
  onError: () => void;
};

/** One visible session owns output; failed requests can be retried by the next gesture. */
export function createAudioLeadership({ locks, name, visible, onChange, onError }: Options) {
  type Owner = { abort: AbortController; release?: () => void };
  let owner: Owner | null = null, disposed = false;
  const release = () => {
    const previous = owner;
    owner = null;
    previous?.abort.abort();
    previous?.release?.();
    onChange(false);
  };
  const acquire = () => {
    if (owner || disposed || !visible()) return;
    const current: Owner = { abort: new AbortController() };
    owner = current;
    if (!locks) { onChange(true); return; }
    void (async () => {
      try {
        await locks.request(name, { signal: current.abort.signal }, async () => {
          if (owner !== current || disposed || !visible()) return;
          onChange(true);
          await new Promise<void>(resolve => { current.release = resolve; });
        });
      } catch {
        if (owner === current && !disposed && !current.abort.signal.aborted) onError();
      } finally {
        // A released request may settle after visibility or HMR started a newer owner.
        if (owner === current) { owner = null; onChange(false); }
      }
    })();
  };
  return { acquire, release, dispose: () => { disposed = true; release(); } };
}
