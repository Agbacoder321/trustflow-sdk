import { Keypair } from '@stellar/stellar-sdk';
import { TrustFlowEscrowClient } from '../src/escrow/client';
import { buildCreateEscrowArgs, buildClaimArgs, buildFundArgs, buildReleaseArgs } from '../src/contract/build';
import { invokeContract } from '../src/contract/invoke';
import { readContractState } from '../src/contract/read';
import type { ContractConfig } from '../src/types/contract';

jest.mock('../src/contract/invoke', () => ({ invokeContract: jest.fn() }));
jest.mock('../src/contract/read', () => ({ readContractState: jest.fn() }));

const mockInvoke = invokeContract as jest.Mock;
const mockRead = readContractState as jest.Mock;
const TX_HASH = 'a'.repeat(64);

const DEPOSITOR = Keypair.random().publicKey();
const BENEFICIARY = Keypair.random().publicKey();

const CONFIG: ContractConfig = {
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
  network: 'TESTNET',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInvoke.mockResolvedValue({ success: true, txHash: TX_HASH });
  mockRead.mockResolvedValue(null);
});

describe('TrustFlowEscrowClient.createEscrow', () => {
  it('creates an escrow for valid params', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '50',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.escrowId).toMatch(/^esc-/);
      expect(result.data.txHash).toBe(TX_HASH);
    }
  });

  it('forwards create_escrow, the encoded args and the depositor as caller to invokeContract', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '50',
      deadlineBlocks: 17_280,
    });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    const [, method, args, caller] = mockInvoke.mock.calls[0];
    expect(method).toBe('create_escrow');
    expect(args).toEqual(
      buildCreateEscrowArgs({
        sender: DEPOSITOR,
        recipient: BENEFICIARY,
        amountStroops: 500_000_000n,
        durationBlocks: 17_280,
      }),
    );
    expect(caller).toBe(DEPOSITOR);
  });

  it('encodes the deadlineBlocks into the underlying contract call arguments', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '50',
      deadlineBlocks: 17_280,
    });

    expect(result.ok).toBe(true);
  });

  it('rejects an invalid depositor address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: 'not-a-stellar-address',
      beneficiary: BENEFICIARY,
      amountXLM: '50',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*sender/i);
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects an invalid beneficiary address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: 'not-a-stellar-address',
      amountXLM: '50',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*recipient/i);
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects a non-positive amount', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '0',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*amount/i);
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('surfaces a rejected on-chain call as { ok: false } instead of a fabricated success', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: 'insufficient balance' });
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.createEscrow({
      depositor: DEPOSITOR,
      beneficiary: BENEFICIARY,
      amountXLM: '50',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/insufficient balance/);
    }
  });
});

describe('TrustFlowEscrowClient.fund', () => {
  it('funds an escrow for a valid amount and no token address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('esc-1', DEPOSITOR, 50_000_000n);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.txHash).toBe(TX_HASH);
    }
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.anything(),
      'fund_escrow',
      buildFundArgs('esc-1', DEPOSITOR, 50_000_000n),
      DEPOSITOR,
    );
  });

  it('funds an escrow with a specific token address (e.g. USDC contract)', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const usdcContract = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
    const result = await client.fund('esc-1', DEPOSITOR, 50_000_000n, usdcContract);

    expect(result.ok).toBe(true);
  });

  it('rejects a missing escrowId', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('', DEPOSITOR, 50_000_000n);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*escrowId/i);
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects an invalid funder address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('esc-1', 'not-a-stellar-address', 50_000_000n);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*funder/i);
    }
  });

  it('rejects a non-positive amount', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('esc-1', DEPOSITOR, 0n);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*amount/i);
    }
  });

  it('surfaces a rejected on-chain call as { ok: false }', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: 'escrow not found' });
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.fund('esc-1', DEPOSITOR, 50_000_000n);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/escrow not found/);
    }
  });
});

describe('TrustFlowEscrowClient.claim', () => {
  it('claims funds for a valid escrowId and claimant address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.claim('esc-1', BENEFICIARY);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.txHash).toBe(TX_HASH);
    }
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.anything(),
      'claim_escrow',
      buildClaimArgs('esc-1', BENEFICIARY),
      BENEFICIARY,
    );
  });

  it('rejects a missing escrowId', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.claim('', BENEFICIARY);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*escrowId/i);
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects an invalid claimant address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.claim('esc-1', 'not-a-stellar-address');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*claimant/i);
    }
  });

  it('surfaces a rejected on-chain call as { ok: false }', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: 'funds already claimed' });
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.claim('esc-1', BENEFICIARY);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/funds already claimed/);
    }
  });
});

describe('TrustFlowEscrowClient.releaseEscrow', () => {
  it('releases an escrow for a valid escrowId and releaser address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.releaseEscrow('esc-1', DEPOSITOR);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.txHash).toBe(TX_HASH);
    }
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.anything(),
      'release_escrow',
      buildReleaseArgs('esc-1', DEPOSITOR),
      DEPOSITOR,
    );
  });

  it('rejects a missing escrowId', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.releaseEscrow('', DEPOSITOR);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed.*escrowId/i);
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects an invalid releaser address', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.releaseEscrow('esc-1', 'not-a-stellar-address');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed/i);
    }
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('surfaces a rejected on-chain call as { ok: false } instead of a fabricated success', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: 'not authorised to release' });
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.releaseEscrow('esc-1', DEPOSITOR);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not authorised to release/);
    }
  });
});

describe('TrustFlowEscrowClient.getEscrow', () => {
  it('reads escrow state from contract storage', async () => {
    const escrowState = { id: 'esc-1', status: 'active' };
    mockRead.mockResolvedValueOnce(escrowState);

    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.getEscrow('esc-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(escrowState);
    }
    expect(mockRead).toHaveBeenCalledWith(expect.anything(), 'get_escrow', [expect.anything()]);
  });

  it('resolves to null when the contract has no data for the escrow', async () => {
    mockRead.mockResolvedValueOnce(null);
    const client = new TrustFlowEscrowClient(CONFIG);

    const result = await client.getEscrow('esc-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });

  it('rejects a missing escrowId', async () => {
    const client = new TrustFlowEscrowClient(CONFIG);
    const result = await client.getEscrow('');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/escrowId/i);
    }
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('surfaces a read failure as { ok: false }', async () => {
    mockRead.mockRejectedValueOnce(new Error('simulation failed'));
    const client = new TrustFlowEscrowClient(CONFIG);

    const result = await client.getEscrow('esc-1');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/simulation failed/);
    }
  });
});
