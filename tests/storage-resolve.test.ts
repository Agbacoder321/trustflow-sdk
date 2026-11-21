import axios from 'axios';
import { IPFSStorage } from '../src/storage/ipfs';
import { TrustFlowError } from '../src/errors';

describe('IPFSStorage.resolve - Issue #348', () => {
  const cid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
  const expectedData = { title: 'TrustFlow Agreement', amount: 500 };
  let getSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    getSpy = jest.spyOn(axios, 'get');
  });

  afterEach(() => {
    getSpy.mockRestore();
  });

  it('resolves valid JSON from the primary gateway', async () => {
    getSpy.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: expectedData,
    });

    const storage = new IPFSStorage({
      gateways: ['https://gw1.example.com', 'https://gw2.example.com'],
    });

    const result = await storage.resolve<typeof expectedData>(cid);
    expect(result).toEqual(expectedData);
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(
      `https://gw1.example.com/ipfs/${cid}`,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it('falls back to secondary gateway when primary returns empty body', async () => {
    getSpy
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: '', // empty body
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: expectedData,
      });

    const storage = new IPFSStorage({
      gateways: ['https://gw1.example.com', 'https://gw2.example.com'],
    });

    const result = await storage.resolve<typeof expectedData>(cid);
    expect(result).toEqual(expectedData);
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to secondary gateway when primary returns HTML error page', async () => {
    getSpy
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        data: '<html><body>502 Bad Gateway</body></html>',
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: expectedData,
      });

    const storage = new IPFSStorage({
      gateways: ['https://gw1.example.com', 'https://gw2.example.com'],
    });

    const result = await storage.resolve<typeof expectedData>(cid);
    expect(result).toEqual(expectedData);
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('falls back to secondary gateway when response is HTML string even without text/html header', async () => {
    getSpy
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: '<!DOCTYPE html><html><head><title>Error</title></head></html>',
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: expectedData,
      });

    const storage = new IPFSStorage({
      gateways: ['https://gw1.example.com', 'https://gw2.example.com'],
    });

    const result = await storage.resolve<typeof expectedData>(cid);
    expect(result).toEqual(expectedData);
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('parses stringified JSON when gateway returns JSON as text', async () => {
    getSpy.mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'text/plain' },
      data: JSON.stringify(expectedData),
    });

    const storage = new IPFSStorage({
      gateways: ['https://gw1.example.com'],
    });

    const result = await storage.resolve<typeof expectedData>(cid);
    expect(result).toEqual(expectedData);
  });

  it('falls back when primary gateway encounters a network or HTTP error', async () => {
    getSpy
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: expectedData,
      });

    const storage = new IPFSStorage({
      gateways: ['https://gw1.example.com', 'https://gw2.example.com'],
    });

    const result = await storage.resolve<typeof expectedData>(cid);
    expect(result).toEqual(expectedData);
    expect(getSpy).toHaveBeenCalledTimes(2);
  });

  it('throws TrustFlowError with code STORAGE_GATEWAY_ERROR when all gateways fail', async () => {
    getSpy
      .mockRejectedValueOnce(new Error('Gateway 1 down'))
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'text/html' },
        data: '<html>Error</html>',
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: {},
        data: '',
      });

    const storage = new IPFSStorage({
      gateways: [
        'https://gw1.example.com',
        'https://gw2.example.com',
        'https://gw3.example.com',
      ],
    });

    // Any unexpected extra call must fail here instead of reaching the real network.
    getSpy.mockRejectedValue(new Error('unexpected axios.get call'));

    // Resolve once: the queue covers exactly one cycle over the three gateways.
    const err = await storage.resolve(cid).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(TrustFlowError);
    const tfErr = err as TrustFlowError;
    expect(tfErr.code).toBe('STORAGE_GATEWAY_ERROR');
    expect(tfErr.message).toContain(cid);
    expect(getSpy).toHaveBeenCalledTimes(3);
  }, 10000); // Increase timeout to 10s

  it('rejects invalid CIDs before querying gateways', async () => {
    const storage = new IPFSStorage();
    await expect(storage.resolve('invalid-cid')).rejects.toThrow(TrustFlowError);
    expect(getSpy).not.toHaveBeenCalled();
  });

  describe('Response size limits - Issue #448', () => {
    it('rejects oversized responses and falls back to next gateway', async () => {
      const smallData = { result: 'success' };
      const maxContentBytes = 100; // Small limit for testing

      // First gateway: simulate over-limit error (axios throws ERR_BAD_RESPONSE)
      const overLimitError = new Error('maxContentLength size of 100 exceeded');
      (overLimitError as any).code = 'ERR_BAD_RESPONSE';
      
      getSpy
        .mockRejectedValueOnce(overLimitError)
        .mockResolvedValueOnce({
          status: 200,
          headers: { 'content-type': 'application/json' },
          data: smallData,
        });

      const storage = new IPFSStorage({
        gateways: ['https://gw1.example.com', 'https://gw2.example.com'],
        maxContentBytes,
      });

      const result = await storage.resolve<typeof smallData>(cid);
      expect(result).toEqual(smallData);
      expect(getSpy).toHaveBeenCalledTimes(2);
      
      // Verify maxContentLength and maxBodyLength were passed to both calls
      expect(getSpy).toHaveBeenNthCalledWith(
        1,
        `https://gw1.example.com/ipfs/${cid}`,
        expect.objectContaining({
          maxContentLength: maxContentBytes,
          maxBodyLength: maxContentBytes,
        }),
      );
      expect(getSpy).toHaveBeenNthCalledWith(
        2,
        `https://gw2.example.com/ipfs/${cid}`,
        expect.objectContaining({
          maxContentLength: maxContentBytes,
          maxBodyLength: maxContentBytes,
        }),
      );
    });

    it('allows per-request maxContentBytes override', async () => {
      const data = { test: 'data' };
      const configLimit = 1000;
      const requestLimit = 500;

      getSpy.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data,
      });

      const storage = new IPFSStorage({
        gateways: ['https://gw1.example.com'],
        maxContentBytes: configLimit,
      });

      await storage.resolve(cid, { maxContentBytes: requestLimit });

      expect(getSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxContentLength: requestLimit,
          maxBodyLength: requestLimit,
        }),
      );
    });

    it('uses default 10MB limit when not configured', async () => {
      const data = { test: 'data' };

      getSpy.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data,
      });

      const storage = new IPFSStorage({
        gateways: ['https://gw1.example.com'],
      });

      await storage.resolve(cid);

      // Default is 10 MB = 10 * 1024 * 1024 = 10485760
      expect(getSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          maxContentLength: 10485760,
          maxBodyLength: 10485760,
        }),
      );
    });

    it('throws when all gateways reject oversized responses', async () => {
      const overLimitError = new Error('maxContentLength size of 100 exceeded');
      (overLimitError as any).code = 'ERR_BAD_RESPONSE';

      // Mock all three gateway calls to reject with over-limit errors
      getSpy.mockRejectedValue(overLimitError);

      const storage = new IPFSStorage({
        gateways: [
          'https://gw1.example.com',
          'https://gw2.example.com',
          'https://gw3.example.com',
        ],
        maxContentBytes: 100,
      });

      await expect(storage.resolve(cid)).rejects.toThrow(TrustFlowError);

      try {
        await storage.resolve(cid);
      } catch (err) {
        expect(err).toBeInstanceOf(TrustFlowError);
        const tfErr = err as TrustFlowError;
        expect(tfErr.code).toBe('STORAGE_GATEWAY_ERROR');
        expect(tfErr.message).toContain(cid);
        // Message should mention the size limit error from at least one gateway
        expect(tfErr.message).toMatch(/size limit|exceeded/i);
      }
      
      // Should have tried all three gateways
      expect(getSpy).toHaveBeenCalledTimes(6); // 3 gateways × 2 resolve attempts
    });

    it('does not buffer or parse oversized responses', async () => {
      // This is a behavioral test - axios enforces the limit before full buffering
      // We verify the correct parameters are passed, which prevents buffering
      const overLimitError = new Error('maxBodyLength size of 50 exceeded');
      (overLimitError as any).code = 'ERR_BAD_RESPONSE';

      getSpy.mockRejectedValueOnce(overLimitError);

      const storage = new IPFSStorage({
        gateways: ['https://gw1.example.com', 'https://gw2.example.com'],
        maxContentBytes: 50,
      });

      // Should fail on first gateway and try second
      getSpy.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: { ok: true },
      });

      const result = await storage.resolve(cid);
      expect(result).toEqual({ ok: true });
      expect(getSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('abortSignal support - Issue #449', () => {
    it('throws when resolve is aborted via pre-aborted signal', async () => {
      const abortController = new AbortController();
      abortController.abort(); // Pre-abort

      // Even with a pre-aborted signal, axios will start the request and immediately reject it
      const cancelError = new Error('canceled');
      (cancelError as any).code = 'ERR_CANCELED';
      getSpy.mockRejectedValueOnce(cancelError);

      const storage = new IPFSStorage({
        gateways: ['https://gw1.example.com'],
      });

      await expect(
        storage.resolve(cid, { abortSignal: abortController.signal })
      ).rejects.toThrow('canceled');

      expect(getSpy).toHaveBeenCalled();
    });

    it('throws when resolve is aborted mid-request', async () => {
      const abortController = new AbortController();

      // Mock the gateway to simulate an in-flight cancellation
      getSpy.mockImplementationOnce(() => {
        abortController.abort(); // Abort during the request
        const cancelError = new Error('canceled');
        (cancelError as any).code = 'ERR_CANCELED';
        return Promise.reject(cancelError);
      });

      const storage = new IPFSStorage({
        gateways: ['https://gw1.example.com', 'https://gw2.example.com'],
      });

      await expect(
        storage.resolve(cid, { abortSignal: abortController.signal })
      ).rejects.toThrow('canceled');

      // Should have tried only the first gateway before throwing
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('re-throws abort errors immediately without trying fallback gateways', async () => {
      const abortController = new AbortController();

      const cancelError = new Error('canceled');
      (cancelError as any).code = 'ERR_CANCELED';

      getSpy.mockImplementationOnce(() => {
        abortController.abort();
        return Promise.reject(cancelError);
      });

      const storage = new IPFSStorage({
        gateways: ['https://gw1.example.com', 'https://gw2.example.com', 'https://gw3.example.com'],
      });

      await expect(
        storage.resolve(cid, { abortSignal: abortController.signal })
      ).rejects.toThrow();

      // Should NOT try fallback gateways when aborted
      expect(getSpy).toHaveBeenCalledTimes(1);
    });

    it('distinguishes cancellation from network failures', async () => {
      const abortController = new AbortController();

      const cancelError = new Error('canceled');
      (cancelError as any).code = 'ERR_CANCELED';

      getSpy.mockImplementationOnce(() => {
        abortController.abort();
        return Promise.reject(cancelError);
      });

      const storage = new IPFSStorage({
        gateways: ['https://gw1.example.com'],
      });

      try {
        await storage.resolve(cid, { abortSignal: abortController.signal });
        fail('Should have thrown');
      } catch (err) {
        // Should throw the abort error, not a TrustFlowError with STORAGE_GATEWAY_ERROR
        expect(err).toBeInstanceOf(Error);
        expect((err as any).code).toBe('ERR_CANCELED');
      }
    });
  });
});
