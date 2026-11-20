import type { TrustFlowClient } from '../client';
import type { ReleaseEscrowParams } from '../types';
import { TrustFlowError } from '../errors';
import { buildReleaseArgs } from '../contract/build';
import { invokeContract } from '../contract/invoke';

/**
 * Releases escrowed funds to the recipient.
 *
 * Encodes `escrowId`/`caller` via {@link buildReleaseArgs} and submits them
 * through {@link invokeContract}, which maps to the contract's
 * `release_escrow(escrow_id, caller)` call; the contract enforces that
 * `caller` is permitted to release.
 *
 * @param client - Configured {@link TrustFlowClient}
 * @param params - Release parameters: `escrowId` and `caller`
 * @returns The real on-chain transaction hash
 * @throws {TrustFlowError} `VALIDATION_ERROR` if `escrowId` is missing,
 * `UNAUTHORIZED` if `caller` is missing, or a wrapped error if the contract
 * invocation fails or completes without a valid transaction hash
 *
 * @example
 * ```typescript
 * const txId = await releaseEscrow(client, {
 *   escrowId: escrow.id,
 *   caller: senderAddress,
 * });
 * console.log('Release submitted:', txId);
 * ```
 */
export async function releaseEscrow(
  client: TrustFlowClient,
  params: ReleaseEscrowParams,
): Promise<string> {
  if (!params.escrowId) {
    throw TrustFlowError.validation('escrowId', 'Required');
  }
  if (!params.caller) {
    throw TrustFlowError.unauthorized('release');
  }

  const args = buildReleaseArgs(params.escrowId, params.caller);

  const result = await invokeContract(client, 'release_escrow', args, params.caller);
  if (!result.success) {
    throw TrustFlowError.wrap(new Error(result.error || 'Escrow release failed'), result.code);
  }
  if (typeof result.txHash !== 'string' || !result.txHash) {
    throw TrustFlowError.submissionFailed('Escrow release completed without a transaction hash');
  }
  return result.txHash;
}
