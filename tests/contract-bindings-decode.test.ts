import { Account, SorobanDataBuilder, xdr } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../src/client';
import { createContractBinding } from '../src/contract/bindings';
import { functionEntry, resultType, udtType, unionEntry } from './support/spec-builders';

// Like tests/contract-invoke-auth.test.ts, this does not mock `@stellar/stellar-sdk`
// or the contract modules: only the RPC server is stubbed, so the real
// invokeContract / readContractState / simulateTransaction path decodes a real
// `retval` ScVal on its way into SorobanContractClient (#579).

const CONTRACT_ID = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const CALLER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const PASSPHRASE = 'Test SDF Network ; September 2015';

const SPEC = [
  functionEntry('get_balance', [], [xdr.ScSpecTypeDef.scSpecTypeU32()]),
  functionEntry('get_status', [], [udtType('Status')]),
  functionEntry(
    'try_get',
    [],
    [resultType(xdr.ScSpecTypeDef.scSpecTypeU32(), xdr.ScSpecTypeDef.scSpecTypeU32())],
  ),
  functionEntry('ping'),
  unionEntry('Status', [
    { name: 'Active' },
    { name: 'Closed', types: [xdr.ScSpecTypeDef.scSpecTypeU32()] },
  ]),
];

/** A stub client whose RPC server simulates every call as returning `retval`. */
function bindingReturning(retval: xdr.ScVal) {
  const server = {
    getAccount: jest.fn().mockResolvedValue(new Account(CALLER, '1')),
    // Shaped like the parsed success response `server.simulateTransaction` returns.
    simulateTransaction: jest.fn().mockResolvedValue({
      _parsed: true,
      id: 'simulation-1',
      latestLedger: 1,
      events: [],
      cost: { cpuInsns: '100', memBytes: '0' },
      minResourceFee: '1000',
      transactionData: new SorobanDataBuilder(),
      result: { auth: [], retval },
    }),
  };
  const client = {
    contractId: CONTRACT_ID,
    getSorobanServer: () => server,
    getNetworkPassphrase: () => PASSPHRASE,
    resolveAccount: () => null,
  } as unknown as TrustFlowClient;
  return createContractBinding(client, SPEC);
}

const activeStatus = () => xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Active')]);
const closedStatus = (code: number) =>
  xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Closed'), xdr.ScVal.scvU32(code)]);

describe('SorobanContractClient.invoke spec-decodes non-void return values (#579)', () => {
  it('returns the decoded scalar instead of throwing', async () => {
    const binding = bindingReturning(xdr.ScVal.scvU32(42));
    const res = await binding.methods.get_balance([], CALLER);
    expect(res).toMatchObject({ success: true, result: 42 });
  });

  it('keeps a falsy return value such as 0', async () => {
    const binding = bindingReturning(xdr.ScVal.scvU32(0));
    const res = await binding.invoke('get_balance', [], CALLER);
    expect(res.result).toBe(0);
  });

  it('decodes a union to its spec { tag, values } shape', async () => {
    const binding = bindingReturning(closedStatus(7));
    const res = await binding.methods.get_status([], CALLER);
    expect(res).toMatchObject({ success: true, result: { tag: 'Closed', values: [7] } });
  });

  it('leaves result undefined for a void method', async () => {
    const binding = bindingReturning(xdr.ScVal.scvVoid());
    const res = await binding.methods.ping([], CALLER);
    expect(res.success).toBe(true);
    expect(res.result).toBeUndefined();
  });

  it('falls back to the native value rather than throwing when the value does not match the spec', async () => {
    const binding = bindingReturning(xdr.ScVal.scvString('not-a-u32'));
    const res = await binding.methods.get_balance([], CALLER);
    expect(res).toMatchObject({ success: true, result: 'not-a-u32' });
  });
});

describe('SorobanContractClient.read spec-decodes the return value (#579)', () => {
  it('decodes a unit union case to { tag } rather than the scValToNative array', async () => {
    const binding = bindingReturning(activeStatus());
    await expect(binding.read('get_status')).resolves.toEqual({ tag: 'Active' });
  });

  it('decodes via the generated read_* method', async () => {
    const binding = bindingReturning(closedStatus(3));
    await expect(binding.methods.read_get_status()).resolves.toEqual({
      tag: 'Closed',
      values: [3],
    });
  });

  it('decodes a Result output to { ok }', async () => {
    const binding = bindingReturning(xdr.ScVal.scvU32(5));
    await expect(binding.methods.readTryGet()).resolves.toEqual({ ok: 5 });
  });

  it('decodes a scalar output', async () => {
    const binding = bindingReturning(xdr.ScVal.scvU32(42));
    await expect(binding.read('get_balance')).resolves.toBe(42);
  });
});
