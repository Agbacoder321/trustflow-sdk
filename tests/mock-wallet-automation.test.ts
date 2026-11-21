import { MockWalletAdapter, createPlaywrightWalletScript } from '../src/testing';

describe('MockWalletAdapter rejection and browser injection (Issue #478)', () => {
  it('simulates user rejection via rejectNext()', async () => {
    const wallet = new MockWalletAdapter();
    expect(await wallet.signTransaction('AAAA')).toBe('AAAA');

    wallet.rejectNext('User declined transaction');
    await expect(wallet.signTransaction('AAAA')).rejects.toThrow('User declined transaction');

    // Subsequent calls succeed
    expect(await wallet.signTransaction('AAAA')).toBe('AAAA');
  });

  it('simulates rejection on connect', async () => {
    const wallet = new MockWalletAdapter({ shouldReject: true });
    await expect(wallet.connect()).rejects.toThrow('User rejected request');
  });

  it('provides a window.freighter-shaped object via toFreighterGlobal()', async () => {
    const wallet = new MockWalletAdapter();
    const globalObj = wallet.toFreighterGlobal();

    expect(await globalObj.isConnected()).toBe(true);
    expect(await globalObj.getPublicKey()).toBe(wallet.publicKey);
    const res = await globalObj.signTransaction('AAAA');
    expect(res.signedXDR).toBe('AAAA');
  });

  it('generates a valid Playwright init script via createPlaywrightWalletScript()', () => {
    const script = createPlaywrightWalletScript({ publicKey: 'G123' });
    expect(script).toContain('window.freighter');
    expect(script).toContain('G123');
  });

  it('signs messages through toFreighterGlobal() per message', async () => {
    const globalObj = new MockWalletAdapter().toFreighterGlobal();

    expect(await globalObj.signMessage('hello')).toBe('mock_sig_hello');
    expect(await globalObj.signMessage('world')).toBe('mock_sig_world');
  });

  it('signs messages through the createPlaywrightWalletScript() injection per message', async () => {
    const script = createPlaywrightWalletScript({ publicKey: 'G123' });
    const injected: { freighter?: { signMessage: (m: string) => Promise<string> } } = {};
    // Evaluate the generated init script against a stand-in window, as the browser would.
    new Function('window', script)(injected);

    expect(await injected.freighter?.signMessage('hello')).toBe('mock_sig_hello');
    expect(await injected.freighter?.signMessage('world')).toBe('mock_sig_world');
  });

  it('makes signMessage behave the same through both injection paths', async () => {
    const wallet = new MockWalletAdapter({ publicKey: 'G123' });
    const jestSide = wallet.toFreighterGlobal();
    const injected: { freighter?: { signMessage: (m: string) => Promise<string> } } = {};
    new Function('window', createPlaywrightWalletScript({ publicKey: 'G123' }))(injected);

    for (const message of ['', 'hello', 'a message with spaces']) {
      expect(await injected.freighter?.signMessage(message)).toBe(
        await jestSide.signMessage(message),
      );
    }
  });
});
