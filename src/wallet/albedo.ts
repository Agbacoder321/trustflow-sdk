export interface AlbedoWallet {
  /**
   * `network` is the network the wallet is currently on (e.g. `public` or
   * `testnet`). It is optional because not every Albedo build reports it.
   */
  publicKey(params?: { token?: string }): Promise<{
    pubkey: string;
    token: string;
    network?: string;
  }>;
  tx(params: {
    xdr: string;
    network?: string;
  }): Promise<{ signed_envelope_xdr: string; tx_hash: string }>;
}

interface AlbedoWindow {
  albedo?: AlbedoWallet;
}

declare const window: AlbedoWindow | undefined;

export function getAlbedo(): AlbedoWallet | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window?.albedo ?? null;
}
