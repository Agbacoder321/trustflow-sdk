import { Keypair } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../src/client';
import { buildReleaseArgs } from '../src/contract/build';
import { invokeContract } from '../src/contract/invoke';
import { releaseEscrow } from '../src/escrow/release';
import { TrustFlowError } from '../src/errors';
import type { ReleaseEscrowParams } from '../src/types';

jest.mock('../src/contract/invoke', () => ({ invokeContract: jest.fn() }));

const mockInvoke = invokeContract as jest.Mock;
const CALLER = Keypair.random().publicKey();
const client = {} as TrustFlowClient;
const TX_HASH = 'a'.repeat(64);

describe('releaseEscrow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockResolvedValue({ success: true, txHash: TX_HASH });
  });

  it('accepts ReleaseEscrowParams from the public top-level types module', async () => {
    const params: ReleaseEscrowParams = {
      escrowId: 'escrow-1',
      caller: CALLER,
    };

    const txId = await releaseEscrow(client, params);

    expect(txId).toBe(TX_HASH);
  });

  it('forwards release_escrow, the encoded args and the caller to invokeContract', async () => {
    await releaseEscrow(client, { escrowId: 'escrow-1', caller: CALLER });

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith(
      client,
      'release_escrow',
      buildReleaseArgs('escrow-1', CALLER),
      CALLER,
    );
  });

  it('rejects a missing escrowId with a validation error', async () => {
    const promise = releaseEscrow(client, { escrowId: '', caller: CALLER });

    await expect(promise).rejects.toBeInstanceOf(TrustFlowError);
    await expect(promise).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('rejects a missing caller with an unauthorized error', async () => {
    const promise = releaseEscrow(client, { escrowId: 'escrow-1', caller: '' });

    await expect(promise).rejects.toBeInstanceOf(TrustFlowError);
    await expect(promise).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('propagates a failed on-chain call as a rejected promise instead of a fabricated success', async () => {
    mockInvoke.mockResolvedValueOnce({ success: false, error: 'simulation failed' });

    const promise = releaseEscrow(client, { escrowId: 'escrow-1', caller: CALLER });

    await expect(promise).rejects.toBeInstanceOf(TrustFlowError);
    await expect(promise).rejects.toMatchObject({ message: expect.stringContaining('simulation failed') });
  });

  it('rejects when the contract call succeeds without producing a transaction hash', async () => {
    mockInvoke.mockResolvedValueOnce({ success: true });

    const promise = releaseEscrow(client, { escrowId: 'escrow-1', caller: CALLER });

    await expect(promise).rejects.toMatchObject({ code: 'SUBMISSION_ERROR' });
  });
});
