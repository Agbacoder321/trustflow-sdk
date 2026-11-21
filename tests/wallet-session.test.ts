/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { useWalletSession } from '../src/hooks/useWalletSession';
import { authenticateWithWallet } from '../src/auth/challenge';
import { clearSession, loadSession, saveSession } from '../src/auth/session';
import type { WalletAdapter } from '../src/wallet/types';

jest.mock('../src/auth/challenge', () => ({ authenticateWithWallet: jest.fn() }));

const auth = authenticateWithWallet as jest.Mock;
const adapter = {
  type: 'freighter',
  connect: jest
    .fn()
    .mockResolvedValue({ type: 'freighter', publicKey: 'GTEST', network: 'TESTNET' }),
  disconnect: jest.fn().mockResolvedValue(undefined),
  signMessage: jest.fn(),
} as unknown as WalletAdapter;

describe('useWalletSession', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  it('restores a session and marks it expiring soon', () => {
    saveSession('opaque', 'GTEST', Date.now() + 30_000);
    const { result } = renderHook(() =>
      useWalletSession({ apiUrl: 'https://api.example', adapter }),
    );
    expect(result.current.status).toBe('authenticated');
    expect(result.current.isExpiringSoon).toBe(true);
    expect(result.current.session?.address).toBe('GTEST');
  });

  it('updates isExpiringSoon when the countdown crosses the threshold', () => {
    jest.useFakeTimers();
    try {
      const start = Date.now();
      jest.setSystemTime(start);
      saveSession('opaque', 'GTEST', start + 6 * 60_000);
      const { result, unmount } = renderHook(() =>
        useWalletSession({ apiUrl: 'https://api.example', adapter }),
      );
      expect(result.current.isExpiringSoon).toBe(false);
      act(() => {
        jest.advanceTimersByTime(61_000);
      });
      expect(result.current.isExpiringSoon).toBe(true);
      unmount();
    } finally {
      jest.useRealTimers();
    }
  });

  it('connects and authenticates through the lower-level flow, then signs out', async () => {
    const next = { token: 'opaque', address: 'GTEST', expiresAt: Date.now() + 600_000 };
    auth.mockImplementationOnce(async () => {
      saveSession(next.token, next.address, next.expiresAt);
      return next;
    });
    const { result } = renderHook(() =>
      useWalletSession({ apiUrl: 'https://api.example', adapter }),
    );
    await act(async () => {
      await result.current.signIn();
    });
    expect(auth).toHaveBeenCalledWith('https://api.example', 'GTEST', adapter, expect.any(Object));
    expect(result.current.status).toBe('authenticated');
    expect(result.current.isExpiringSoon).toBe(false);
    await act(async () => {
      await result.current.signOut();
    });
    expect(result.current.status).toBe('signedOut');
    expect(loadSession()).toBeNull();
    clearSession();
  });
});
