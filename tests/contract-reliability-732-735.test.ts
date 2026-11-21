import { classifySimulationError } from '../src/contract/invoke';
import { generateTypeScriptBindings } from '../src/contract/bindings';
import { createRpcEventFetcher } from '../src/events';
import { RequestDeduplicator } from '../src/utils/dedup';

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';

describe('classifySimulationError (#732)', () => {
  it('reports a host budget failure as resource_limit', () => {
    expect(classifySimulationError('HostError: Error(Budget, ExceededLimit)')).toBe('resource_limit');
  });

  it('reports a contract panic or contract error as contract', () => {
    expect(classifySimulationError('HostError: Error(Contract, #3)')).toBe('contract');
    expect(classifySimulationError('HostError: Error(WasmVm, InvalidAction)')).toBe('contract');
  });

  it('reports anything else as unknown', () => {
    expect(classifySimulationError('socket hang up')).toBe('unknown');
    expect(classifySimulationError(undefined)).toBe('unknown');
  });
});

describe('RequestDeduplicator skipCache (#733)', () => {
  it('starts a fresh request instead of joining one already in flight', async () => {
    const dedup = new RequestDeduplicator();
    let release!: (v: string) => void;
    const slow = () => new Promise<string>((r) => (release = r));
    const stale = dedup.deduplicate('k', slow, { ttlMs: 60_000 });

    const latest = await dedup.deduplicate('k', async () => 'fresh', { skipCache: true });
    expect(latest).toBe('fresh');

    release('stale');
    await stale;
    expect(dedup.isInFlight('k')).toBe(false);
    // A later skipCache call still bypasses the value cached by the stale request.
    const newer = await dedup.deduplicate('k', async () => 'newer', { skipCache: true });
    expect(newer).toBe('newer');
  });
});

describe('createRpcEventFetcher topic filters (#734)', () => {
  it('sends the same filters on every request, including resumed ones', async () => {
    const requests: Array<Record<string, unknown>> = [];
    let calls = 0;
    const server = {
      getEvents: async (req: Record<string, unknown>) => {
        requests.push(req);
        calls += 1;
        if (calls === 2) throw new Error('connection reset');
        return { events: [], latestLedger: 10 };
      },
    };
    const topics = [['AAAADwAAAA5lc2Nyb3dfY3JlYXRlZAAA', '*']];
    const fetchPage = createRpcEventFetcher(server, { contractId: CONTRACT_ID, topics });

    await fetchPage();
    await expect(fetchPage('cursor-1')).rejects.toThrow('connection reset');
    await fetchPage('cursor-1');

    expect(requests).toHaveLength(3);
    for (const req of requests) {
      expect(req['filters']).toEqual([{ type: 'contract', contractIds: [CONTRACT_ID], topics }]);
    }
    expect(requests[2]['cursor']).toBe('cursor-1');
  });
});

describe('generateTypeScriptBindings (#735)', () => {
  it('extends the concrete SorobanContractClient so the generated class compiles', () => {
    const code = generateTypeScriptBindings([], { className: 'Gen' });
    expect(code).toContain('export class Gen extends SorobanContractClient {');
    expect(code).not.toContain('extends AbstractContractClient');
  });
});
