import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticateWithWallet } from '../auth/challenge';
import type { AuthFlowOptions } from '../auth/challenge';
import { clearSession, isSessionExpired, loadSession, type Session } from '../auth/session';
import { TokenRefreshManager } from '../auth/tokenRefresh';
import { connectWallet, disconnectWallet } from '../wallet/connect';
import { createFreighterAdapter } from '../wallet/adapter';
import type { WalletAdapter, WalletType } from '../wallet/types';

export type WalletSessionStatus = 'signedOut' | 'signingIn' | 'authenticated' | 'expired' | 'error';

export interface UseWalletSessionOptions extends AuthFlowOptions {
  /** TrustFlow backend URL. */
  apiUrl: string;
  /** Defaults to Freighter. Other wallets need an adapter with signMessage. */
  walletType?: WalletType;
  adapter?: WalletAdapter;
  /** Time before expiry at which isExpiringSoon becomes true. Defaults to five minutes. */
  expiringSoonMs?: number;
}

/** Connects, signs a challenge, verifies it, persists the token and refreshes it before expiry. */
export function useWalletSession(options: UseWalletSessionOptions) {
  const { apiUrl, scope, walletType = 'freighter', adapter, expiringSoonMs = 300_000 } = options;
  const [session, setSession] = useState<Session | null>(() => {
    const stored = loadSession(scope);
    return isSessionExpired(stored) ? null : stored;
  });
  const [status, setStatus] = useState<WalletSessionStatus>(() =>
    isSessionExpired(loadSession(scope)) ? 'signedOut' : 'authenticated',
  );
  const [error, setError] = useState<Error | null>(null);
  const [now, setNow] = useState(Date.now);
  const managerRef = useRef<TokenRefreshManager | null>(null);
  const operationRef = useRef(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const stored = loadSession(scope);
    setSession(isSessionExpired(stored) ? null : stored);
    setStatus(
      stored && isSessionExpired(stored) ? 'expired' : stored ? 'authenticated' : 'signedOut',
    );
    const manager = new TokenRefreshManager({
      apiUrl,
      scope,
      retry: optionsRef.current.retry,
      listener: {
        onRefresh: (next) => {
          if (managerRef.current !== manager) return;
          setSession(next);
          setStatus('authenticated');
          setError(null);
          setNow(Date.now());
        },
        onRefreshError: (cause) => {
          if (managerRef.current !== manager) return;
          setError(cause);
          if (isSessionExpired(loadSession(scope))) setStatus('expired');
        },
      },
    });
    managerRef.current = manager;
    if (stored && !isSessionExpired(stored)) manager.start();
    return () => {
      manager.stop();
      if (managerRef.current === manager) managerRef.current = null;
    };
  }, [apiUrl, scope]);

  useEffect(() => {
    const timer = setInterval(() => {
      const time = Date.now();
      setNow(time);
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (session && now >= session.expiresAt) {
      setSession(null);
      setStatus('expired');
    }
  }, [session, now]);

  const signIn = useCallback(async (): Promise<Session> => {
    const operation = ++operationRef.current;
    setStatus('signingIn');
    setError(null);
    try {
      const signer = adapter ?? (walletType === 'freighter' ? createFreighterAdapter() : undefined);
      if (!signer) throw new Error(`${walletType} requires a WalletAdapter with signMessage`);
      const connection = adapter ? await adapter.connect() : await connectWallet(walletType);
      const next = await authenticateWithWallet(
        apiUrl,
        connection.publicKey,
        signer,
        optionsRef.current,
      );
      if (operation !== operationRef.current) {
        if (loadSession(scope)?.token === next.token) clearSession(scope);
        return next;
      }
      setSession(next);
      setStatus('authenticated');
      setNow(Date.now());
      managerRef.current?.start();
      return next;
    } catch (cause) {
      if (operation === operationRef.current) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setStatus('error');
      }
      throw cause;
    }
  }, [adapter, walletType, apiUrl, scope]);

  const signOut = useCallback(async (): Promise<void> => {
    ++operationRef.current;
    managerRef.current?.stop();
    try {
      if (adapter) await adapter.disconnect();
      else await disconnectWallet();
    } finally {
      clearSession(scope);
      setSession(null);
      setStatus('signedOut');
      setError(null);
    }
  }, [adapter, scope]);

  return {
    session,
    status,
    error,
    signIn,
    signOut,
    isExpiringSoon: session !== null && session.expiresAt - now <= expiringSoonMs,
  };
}
