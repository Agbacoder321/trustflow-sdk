import type { TrustFlowClient } from '../client';
import { EscrowStatus } from '../types';
import type { CreateEscrowParams, Escrow } from '../types';
import { TrustFlowError } from '../errors';
import { ESCROW_MIN_AMOUNT_STROOPS } from '../constants';
import { buildCreateEscrowArgs } from '../contract/build';
import { invokeContract } from '../contract/invoke';
import { normalizeMilestoneExpiration, validateFutureExpiration } from '../utils/timezone';

/**
 * Creates a new escrow by invoking `create_escrow` on the TrustFlow contract.
 *
 * Validates the amount against {@link ESCROW_MIN_AMOUNT_STROOPS} and requires
 * both parties before encoding the Soroban call arguments via
 * {@link buildCreateEscrowArgs}.
 *
 * Enforces UTC Unix timestamps for milestone expiration parameters, rejecting past
 * deadlines with an `INVALID_EXPIRATION` error.
 *
 * The on-chain `create_escrow` function takes only `(depositor, beneficiary, amount)`
 * and has no deadline parameter, so a top-level `deadline`/`expiresAt` cannot be
 * enforced by the contract. Such a deadline is validated and then rejected rather
 * than silently dropped.
 *
 * @param client - Configured {@link TrustFlowClient}
 * @param params - Escrow terms: sender, recipient, amount in stroops, duration, milestones
 * @returns The newly created {@link Escrow} in {@link EscrowStatus.Pending}
 * @throws {TrustFlowError} `VALIDATION_ERROR` if `amountStroops` is below the minimum, or if
 *   `deadline`/`expiresAt` is supplied (unsupported by the contract);
 *   `INVALID_EXPIRATION` if a deadline/milestone expiration is in the past
 */
export async function createEscrow(
  client: TrustFlowClient,
  params: CreateEscrowParams,
): Promise<Escrow> {
  if (params.amountStroops < ESCROW_MIN_AMOUNT_STROOPS) {
    throw TrustFlowError.validation('amountStroops', `Minimum is ${ESCROW_MIN_AMOUNT_STROOPS}`);
  }
  if (!params.sender || !params.recipient) {
    throw TrustFlowError.validation('sender/recipient', 'Both addresses are required');
  }

  const deadlineInput = params.deadline ?? params.expiresAt;
  const deadlineField = params.deadline !== undefined ? 'deadline' : 'expiresAt';
  if (deadlineInput !== undefined) {
    // Validate first so a past deadline still reports INVALID_EXPIRATION.
    validateFutureExpiration(deadlineInput, deadlineField);
    throw TrustFlowError.validation(
      deadlineField,
      `not supported: the on-chain create_escrow function has no deadline parameter, so it cannot be enforced`,
    );
  }

  let normalizedMilestones: any[] | undefined;
  if (params.milestones && Array.isArray(params.milestones)) {
    normalizedMilestones = normalizeMilestoneExpiration(params.milestones);
  }

  const args = buildCreateEscrowArgs({
    sender: params.sender,
    recipient: params.recipient,
    amountStroops: params.amountStroops,
    durationBlocks: params.durationBlocks,
    milestones: normalizedMilestones ?? params.milestones,
  });

  const result = await invokeContract(client, 'create_escrow', args, params.sender);
  if (!result.success) {
    // Keep the contract's own message and the original result as `cause`, so a
    // caller can tell an insufficient balance from any other failure (#717).
    throw new TrustFlowError(
      `Escrow creation failed: ${result.error ?? 'unknown contract error'}`,
      'CONTRACT_ERROR',
      result,
    );
  }

  return {
    id: `escrow-${Date.now()}`,
    sender: params.sender,
    recipient: params.recipient,
    amount: params.amountStroops,
    status: EscrowStatus.Pending,
    createdAt: Date.now(),
    metadata: params.metadata,
    milestones: normalizedMilestones ?? params.milestones,
  };
}
