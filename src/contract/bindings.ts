import { xdr, Contract, Account, TransactionBuilder, BASE_FEE } from '@stellar/stellar-sdk';
import type { TrustFlowClient } from '../client';
import type { ContractCallResult } from '../types/contract';
import type { SimulationResult } from './simulate';
import type { SignAndSubmitFn } from './invoke';
import { invokeContract } from './invoke';
import { simulateContractRead } from './read';
import { simulateContractCall } from './simulate';
import { AbstractContractClient } from './abstract';
import { SorobanSpec } from './spec';
import { describeError, logger } from '../utils/logger';

/**
 * Concrete implementation of `AbstractContractClient` created from Soroban Spec entries.
 * Executes spec-validated contract calls, reads, and simulations.
 */
export class SorobanContractClient extends AbstractContractClient {
  /** Map of dynamically generated contract methods bound to this client instance */
  readonly methods: Record<string, (...args: never[]) => Promise<unknown>> = {};

  constructor(
    client: TrustFlowClient,
    specEntries: (xdr.ScSpecEntry | string | Uint8Array | Buffer)[],
    contractId?: string,
  ) {
    super(client, specEntries, contractId);
    this.bindMethods();
  }

  private bindMethods(): void {
    for (const [fnName] of this.spec.functions.entries()) {
      const invokeFn = async (
        args: Record<string, unknown> | unknown[],
        caller: string,
        signAndSubmit?: SignAndSubmitFn,
      ) => {
        return this.invoke(fnName, args, caller, signAndSubmit);
      };

      const readFn = async (args?: Record<string, unknown> | unknown[]) => {
        return this.read(fnName, args);
      };

      const simulateFn = async (args?: Record<string, unknown> | unknown[]) => {
        return this.simulate(fnName, args);
      };

      this.methods[fnName] = invokeFn;
      (this.methods as Record<string, unknown>)[`read_${fnName}`] = readFn;
      (this.methods as Record<string, unknown>)[`simulate_${fnName}`] = simulateFn;

      // CamelCase alias
      const camelName = toCamelCase(fnName);
      if (camelName !== fnName) {
        this.methods[camelName] = invokeFn;
        const camelCap = camelName.charAt(0).toUpperCase() + camelName.slice(1);
        (this.methods as Record<string, unknown>)[`read${camelCap}`] = readFn;
        (this.methods as Record<string, unknown>)[`simulate${camelCap}`] = simulateFn;
      }

      // Also attach directly onto this instance if not colliding with existing properties
      if (!(fnName in this)) {
        (this as Record<string, unknown>)[fnName] = invokeFn;
      }
      if (!(camelName in this)) {
        (this as Record<string, unknown>)[camelName] = invokeFn;
      }
    }
  }

  /**
   * Invokes a contract method using typed Soroban spec encoding.
   *
   * @param methodName - Function name defined in contract spec
   * @param args - Positional arguments array or named parameter object map
   * @param caller - Address of the caller initiating the transaction
   * @param signAndSubmit - Optional callback to sign and submit transaction XDR
   */
  async invoke<T = unknown>(
    methodName: string,
    args: Record<string, unknown> | unknown[],
    caller: string,
    signAndSubmit?: SignAndSubmitFn,
  ): Promise<ContractCallResult & { result?: T }> {
    const scVals = this.encodeArgs(methodName, args);
    const result = await invokeContract(this.client, methodName, scVals, caller, signAndSubmit);
    let decoded: T | undefined = undefined;
    // Decode the raw ScVal against the spec: `returnValue` is already native
    // (`scValToNative`) and the spec decoder cannot take it (#579). A void return
    // leaves `result` undefined.
    const raw = result.rawReturnValue;
    if (result.success && raw && raw.switch().name !== 'scvVoid') {
      try {
        decoded = this.decodeReturnValue(methodName, raw) as T;
      } catch (e) {
        // The call has already succeeded (and may have been submitted), so a
        // value that does not match the spec must not discard `txHash`.
        logger.warn('Return value does not match the contract spec', {
          method: methodName,
          error: describeError(e),
        });
        decoded = result.returnValue as T;
      }
    }
    return {
      ...result,
      result: decoded,
    };
  }

  /**
   * Reads contract state by simulating a read-only contract method.
   *
   * @param methodName - Function name defined in contract spec
   * @param args - Arguments array or object map
   */
  async read<T = unknown>(
    methodName: string,
    args: Record<string, unknown> | unknown[] = [],
  ): Promise<T> {
    const scVals = this.encodeArgs(methodName, args);
    const outcome = await simulateContractRead(this.client, methodName, scVals);
    // `outcome.returnValue` is the untyped `scValToNative` decode; decode the raw
    // ScVal against the spec instead so enums, unions, results and structs keep
    // their spec shape (#579).
    if (outcome.rawReturnValue) {
      return this.decodeReturnValue(methodName, outcome.rawReturnValue) as T;
    }
    return outcome.returnValue as T;
  }

  /**
   * Simulates execution of a contract method for dry-run validation and fee estimation.
   *
   * Builds a real transaction envelope (using a dummy source account, matching
   * `readContractState`) and simulates it against Soroban RPC. This ensures the
   * simulation reflects the actual call — including footprint, auth entries,
   * and resource cost — rather than a disconnected set of encoded arguments.
   *
   * @param methodName - Function name defined in contract spec
   * @param args - Arguments array or object map
   */
  async simulate(
    methodName: string,
    args: Record<string, unknown> | unknown[] = [],
  ): Promise<SimulationResult> {
    const scVals = this.encodeArgs(methodName, args);
    const contract = new Contract(this.contractId);
    const operation = contract.call(methodName, ...(scVals as any[]));

    // Use a dummy account for simulation, matching readContractState
    const dummyAccount = new Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      '0',
    );

    const tx = new TransactionBuilder(dummyAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.client.getNetworkPassphrase(),
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    return simulateContractCall(this.client, tx.toXDR());
  }
}

/**
 * Creates dynamic type-safe contract client bindings from Soroban spec XDR entries.
 *
 * @param client - TrustFlowClient instance
 * @param specEntries - Array of Soroban spec entries (XDR base64 strings, ScSpecEntry objects, or Buffers)
 * @param contractId - Optional contract ID override
 * @returns SorobanContractClient instance with bound spec methods
 *
 * @example
 * ```typescript
 * const binding = createContractBinding(client, specXdrEntries);
 * const result = await binding.methods.create_escrow({ depositor, beneficiary, amount, duration }, caller);
 * ```
 */
export function createContractBinding<T extends Record<string, any> = Record<string, any>>(
  client: TrustFlowClient,
  specEntries: (xdr.ScSpecEntry | string | Uint8Array | Buffer)[],
  contractId?: string,
): SorobanContractClient & T & { methods: T } {
  const binding = new SorobanContractClient(client, specEntries, contractId);
  return binding as SorobanContractClient & T & { methods: T };
}

/**
 * Alias for `createContractBinding`.
 * Auto-generates contract bindings from Soroban spec XDR.
 */
export const generateContractBindings = createContractBinding;

/**
 * Generates strongly-typed TypeScript client source code from Soroban contract spec entries.
 * The generated code provides compile-time checked contract bindings that mirror the contract ABI.
 *
 * @param specEntries - Array of Soroban spec entries (XDR base64 strings, ScSpecEntry objects, or Buffers)
 * @param options - Code generation options, including target class name
 * @returns TypeScript source code string
 *
 * @example
 * ```typescript
 * const tsCode = generateTypeScriptBindings(specEntries, { className: 'EscrowContractClient' });
 * fs.writeFileSync('src/contracts/EscrowContractClient.ts', tsCode);
 * ```
 */
export function generateTypeScriptBindings(
  specEntries: (xdr.ScSpecEntry | string | Uint8Array | Buffer)[],
  options: { className?: string } = {},
): string {
  const spec = new SorobanSpec(specEntries);
  const className = options.className || 'GeneratedContractClient';

  const lines: string[] = [
    '// Auto-generated by @trustflow/sdk Soroban Spec Binding Generator',
    '// DO NOT EDIT MANUALLY - re-generate using generateTypeScriptBindings()',
    '',
    "import { SorobanContractClient, TrustFlowClient, SignAndSubmitFn, ContractCallResult, SimulationResult } from '@trustflow/sdk';",
    '',
  ];

  // Generate struct interfaces
  for (const [stName, stSpec] of spec.structs.entries()) {
    if (stSpec.doc) {
      lines.push(`/** ${stSpec.doc} */`);
    }
    lines.push(`export interface ${stName} {`);
    for (const field of stSpec.fields) {
      const fieldType = mapScSpecTypeToTs(field.type);
      const docComment = field.doc ? `  /** ${field.doc} */\n` : '';
      lines.push(`${docComment}  ${field.name}: ${fieldType};`);
    }
    lines.push('}');
    lines.push('');
  }

  // Generate enum types
  for (const [enName, enSpec] of spec.enums.entries()) {
    if (enSpec.doc) {
      lines.push(`/** ${enSpec.doc} */`);
    }
    lines.push(`export enum ${enName} {`);
    for (const c of enSpec.cases) {
      const docComment = c.doc ? `  /** ${c.doc} */\n` : '';
      lines.push(`${docComment}  ${c.name} = ${c.value},`);
    }
    lines.push('}');
    lines.push('');
  }

  // Generate union types
  for (const [unName, unSpec] of spec.unions.entries()) {
    if (unSpec.doc) {
      lines.push(`/** ${unSpec.doc} */`);
    }
    const unionCases = unSpec.cases.map((c) => `'${c.name}'`).join(' | ');
    lines.push(`export type ${unName} = ${unionCases || 'string'};`);
    lines.push('');
  }

  // Generate Contract Client Class
  lines.push(`/**`);
  lines.push(` * Auto-generated type-safe contract client for Soroban spec.`);
  lines.push(` */`);
  // Extend the concrete client so the generated class compiles: AbstractContractClient
  // leaves invoke/read/simulate abstract (#735).
  lines.push(`export class ${className} extends SorobanContractClient {`);
  lines.push(`  constructor(client: TrustFlowClient, specEntries: any[], contractId?: string) {`);
  lines.push(`    super(client, specEntries, contractId);`);
  lines.push(`  }`);
  lines.push('');

  for (const [fnName, fnSpec] of spec.functions.entries()) {
    const camelName = toCamelCase(fnName);
    const returnType = fnSpec.outputs.length > 0 ? mapScSpecTypeToTs(fnSpec.outputs[0]) : 'unknown';

    // Build args interface
    const argsTypeFields = fnSpec.inputs
      .map((inp) => `${inp.name}: ${mapScSpecTypeToTs(inp.type)}`)
      .join('; ');
    const argsParamType = argsTypeFields ? `{ ${argsTypeFields} }` : 'Record<string, never>';

    if (fnSpec.doc) {
      lines.push(`  /** ${fnSpec.doc} */`);
    }
    lines.push(`  async ${camelName}(`);
    lines.push(`    args: ${argsParamType},`);
    lines.push(`    caller: string,`);
    lines.push(`    signAndSubmit?: SignAndSubmitFn,`);
    lines.push(`  ): Promise<ContractCallResult & { result?: ${returnType} }> {`);
    lines.push(`    return this.invoke<${returnType}>('${fnName}', args, caller, signAndSubmit);`);
    lines.push(`  }`);
    lines.push('');

    // Read method
    lines.push(
      `  async read${capitalize(camelName)}(args: ${argsParamType}): Promise<${returnType}> {`,
    );
    lines.push(`    return this.read<${returnType}>('${fnName}', args);`);
    lines.push(`  }`);
    lines.push('');

    // Simulate method
    lines.push(
      `  async simulate${capitalize(camelName)}(args: ${argsParamType}): Promise<SimulationResult> {`,
    );
    lines.push(`    return this.simulate('${fnName}', args);`);
    lines.push(`  }`);
    lines.push('');
  }

  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function mapScSpecTypeToTs(typeDef: xdr.ScSpecTypeDef): string {
  const kind = typeDef.switch().name;
  switch (kind) {
    case 'scSpecTypeBool':
      return 'boolean';
    case 'scSpecTypeVoid':
      return 'void';
    case 'scSpecTypeU32':
    case 'scSpecTypeI32':
      return 'number';
    case 'scSpecTypeU64':
    case 'scSpecTypeI64':
    case 'scSpecTypeU128':
    case 'scSpecTypeI128':
    case 'scSpecTypeU256':
    case 'scSpecTypeI256':
    case 'scSpecTypeTimepoint':
    case 'scSpecTypeDuration':
      return 'bigint';
    case 'scSpecTypeString':
    case 'scSpecTypeSymbol':
    case 'scSpecTypeAddress':
      return 'string';
    case 'scSpecTypeBytes':
    case 'scSpecTypeBytesN':
      return 'Uint8Array | string';
    case 'scSpecTypeOption':
      return `${mapScSpecTypeToTs(typeDef.option().valueType())} | null`;
    case 'scSpecTypeVec':
      return `${mapScSpecTypeToTs(typeDef.vec().elementType())}[]`;
    case 'scSpecTypeMap':
      return `Record<${mapScSpecTypeToTs(typeDef.map().keyType())}, ${mapScSpecTypeToTs(typeDef.map().valueType())}>`;
    case 'scSpecTypeUdt':
      return typeDef.udt().name().toString();
    default:
      return 'unknown';
  }
}

function toCamelCase(str: string): string {
  return str.replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
