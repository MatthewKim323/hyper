// EIP-1193 account access only. This module never signs or submits a transaction.
// https://eips.ethereum.org/EIPS/eip-1193
export type WalletProvider = {
  request(args: { method: string }): Promise<unknown>;
  on?(event: string, listener: (value: unknown) => void): void;
  removeListener?(event: string, listener: (value: unknown) => void): void;
};
export type WalletState = { address: string | null; chain: string | null; pending: boolean; error: string | null };
export const EMPTY_WALLET: WalletState = { address: null, chain: null, pending: false, error: null };
export const walletAddress = (value: unknown): string | null => Array.isArray(value) && typeof value[0] === "string" && /^0x[\da-f]{40}$/i.test(value[0]) ? value[0] : null;
export const walletChain = (value: unknown): string | null => typeof value === "string" && /^0x[\da-f]+$/i.test(value) && value.length <= 66 ? value : null;
export function chainLabel(chain: string | null) {
  if (!chain) return "Network unavailable";
  const names: Record<string, string> = { "1": "Ethereum", "10": "Optimism", "137": "Polygon", "8453": "Base", "42161": "Arbitrum One", "11155111": "Sepolia testnet" };
  const id = BigInt(chain).toString();
  return names[id] ?? `Chain ${id}`;
}
export function browserWallet(): WalletProvider | null {
  const provider = (window as Window & { ethereum?: WalletProvider }).ethereum;
  return provider && typeof provider.request === "function" ? provider : null;
}

export function createWalletSession(provider: WalletProvider, publish: (state: WalletState) => void) {
  let state = { ...EMPTY_WALLET };
  let alive = true;
  let generation = 0;
  let chainRevision = 0;
  let watching = false;
  const update = (next: Partial<WalletState>) => { if (alive) { state = { ...state, ...next }; publish(state); } };
  const accounts = (value: unknown) => {
    if (!alive || !watching) return;
    generation++;
    const address = walletAddress(value);
    update({ address, pending: false, ...(!address ? { chain: null } : {}), error: null });
    if (address) void refreshChain(generation);
  };
  const chain = (value: unknown) => {
    if (!alive || !watching) return;
    chainRevision++;
    update({ chain: walletChain(value) });
  };
  const disconnected = () => {
    if (!alive || !watching) return;
    generation++;
    update({ ...EMPTY_WALLET, error: "Your wallet disconnected. Connect again when it is ready." });
  };
  const entries: [string, (value: unknown) => void][] = [["accountsChanged", accounts], ["chainChanged", chain], ["disconnect", disconnected]];
  let subscriptions: typeof entries = [];
  let watchRevision = 0;
  function watch(enabled: boolean) {
    // A request-only provider is supported; event subscriptions must also be removable.
    if (enabled && (!provider.on || !provider.removeListener)) return;
    if (watching === enabled) return;
    watching = enabled;
    const revision = ++watchRevision;
    if (enabled) {
      subscriptions = entries.map(([event, handler]) => [event, (value: unknown) => {
        if (alive && watching && revision === watchRevision) handler(value);
      }]);
      subscriptions.forEach(([event, handler]) => provider.on?.(event, handler));
    } else {
      subscriptions.forEach(([event, handler]) => provider.removeListener?.(event, handler));
      subscriptions = [];
    }
  }
  async function refreshChain(turn: number) {
    const revision = ++chainRevision;
    try { const value = await provider.request({ method: "eth_chainId" }); if (alive && turn === generation && revision === chainRevision) update({ chain: walletChain(value) }); }
    catch { if (alive && turn === generation && revision === chainRevision) update({ chain: null }); }
  }
  return {
    async connect() {
      if (state.pending || !alive) return;
      const turn = ++generation;
      update({ pending: true, error: null });
      // Install events after the initial response: some wallets emit accountsChanged inside
      // eth_requestAccounts. The returned account list already represents that change.
      try {
        const result = await provider.request({ method: "eth_requestAccounts" });
        if (!alive || turn !== generation) return;
        const address = walletAddress(result);
        if (!address) throw new Error("No wallet address was shared. Choose an account in your wallet.");
        update({ address, pending: false });
        watch(true);
        await refreshChain(turn);
      } catch (error) {
        if (!alive || turn !== generation) return;
        const code = (error as { code?: number })?.code;
        update({ pending: false, error: code === 4001 ? "Connection cancelled. You can try again whenever you’re ready." : code === -32002 ? "A wallet request is already open. Finish it in your wallet." : "Could not connect. Unlock your wallet and try again." });
      }
    },
    hide() { generation++; watch(false); update({ ...EMPTY_WALLET }); },
    dispose() { generation++; watch(false); alive = false; },
  };
}
