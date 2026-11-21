import { simulateTransaction } from '../src/contract/simulation';

describe('simulation gateway retry', () => {
  it('retries a no healthy upstream response and returns the next result', async () => {
    const server = {
      simulateTransaction: jest
        .fn()
        .mockResolvedValueOnce({ error: 'no healthy upstream' })
        .mockResolvedValueOnce({ result: {} }),
    };
    const outcome = await simulateTransaction(server as never, {} as never, {
      retry: { retries: 1, retryDelayMs: 0 },
    });
    expect(server.simulateTransaction).toHaveBeenCalledTimes(2);
    expect(outcome.success).toBe(true);
  });
});
