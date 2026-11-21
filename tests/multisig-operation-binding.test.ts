import { Account, Asset, Keypair, Networks, Operation, TransactionBuilder } from '@stellar/stellar-sdk';
import { MultiSigEscrowClient } from '../src/escrow/multisig';

const NETWORK = Networks.TESTNET;

function makeClient(): MultiSigEscrowClient {
  return new MultiSigEscrowClient({ networkPassphrase: NETWORK } as any);
}

/** Builds a deterministic payment transaction sourced from `source` (no timeout, so hashes are stable). */
function buildTx(source: Keypair, amount: string) {
  return new TransactionBuilder(new Account(source.publicKey(), '1'), {
    fee: '100',
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.payment({
        destination: source.publicKey(),
        asset: Asset.native(),
        amount,
      }),
    )
    .setTimeout(0)
    .build();
}

function unsignedXdr(source: Keypair, amount: string): string {
  return buildTx(source, amount).toEnvelope().toXDR('base64');
}

function signedXdr(source: Keypair, amount: string, signer: Keypair): string {
  const tx = buildTx(source, amount);
  tx.sign(signer);
  return tx.toEnvelope().toXDR('base64');
}

function initOperation(
  client: MultiSigEscrowClient,
  base: string,
  signers: string[],
): string {
  const init = client.initMultiSigOperation({
    escrowId: 'esc-715',
    operationType: 'release',
    unsignedXdr: base,
    networkPassphrase: NETWORK,
    signers,
    threshold: 2,
  });
  if (!init.ok) throw new Error(init.error);
  return init.data.operationId;
}

describe('MultiSigEscrowClient.addSignature operation binding (Issue #715)', () => {
  const signerA = Keypair.random();
  const signerB = Keypair.random();
  const outsider = Keypair.random();
  const signers = [signerA.publicKey(), signerB.publicKey()];

  // Operation A and operation B wrap two different transactions.
  const baseA = unsignedXdr(signerA, '1');
  const baseB = unsignedXdr(signerA, '2');
  const signedForA = signedXdr(signerA, '1', signerA);

  describe('normal path', () => {
    it('accepts a signature whose transaction matches the operation', () => {
      const client = makeClient();
      const opA = initOperation(client, baseA, signers);

      const result = client.addSignature({
        operationId: opA,
        signerAddress: signerA.publicKey(),
        signedXdr: signedForA,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.operationId).toBe(opA);
        expect(result.data.signaturesCollected).toBe(1);
        expect(result.data.signersSigned).toEqual([signerA.publicKey()]);
      }
    });
  });

  describe('failure path', () => {
    it('rejects a signature generated for a different operation and stores nothing', () => {
      const client = makeClient();
      const opA = initOperation(client, baseA, signers);
      const opB = initOperation(client, baseB, signers);

      const result = client.addSignature({
        operationId: opB,
        signerAddress: signerA.publicKey(),
        signedXdr: signedForA,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/different transaction than the base unsignedXdr/);
      }
      const statusB = client.getMultiSigStatus(opB);
      expect(statusB.ok && statusB.data.signaturesCollected).toBe(0);
      const statusA = client.getMultiSigStatus(opA);
      expect(statusA.ok && statusA.data.signaturesCollected).toBe(0);
    });

    it('rejects a signed XDR whose signature belongs to someone other than the claimed signer', () => {
      const client = makeClient();
      const opA = initOperation(client, baseA, signers);

      const result = client.addSignature({
        operationId: opA,
        signerAddress: signerB.publicKey(),
        signedXdr: signedForA,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/does not contain a signature from/);
      }
    });

    it('rejects an unknown operationId', () => {
      const client = makeClient();

      const result = client.addSignature({
        operationId: 'msig-missing',
        signerAddress: signerA.publicKey(),
        signedXdr: signedForA,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/not found/);
      }
    });
  });

  describe('authorization path', () => {
    it('rejects a valid signature from an address that is not an authorised signer', () => {
      const client = makeClient();
      const opA = initOperation(client, baseA, signers);
      const outsiderSigned = signedXdr(signerA, '1', outsider);

      const result = client.addSignature({
        operationId: opA,
        signerAddress: outsider.publicKey(),
        signedXdr: outsiderSigned,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/is not an authorised signer/);
      }
    });
  });
});
