import { xdr } from '@stellar/stellar-sdk';
import { generateTypeScriptBindings } from '../src/contract/bindings';

const t = {
  u32: () => xdr.ScSpecTypeDef.scSpecTypeU32(),
  string: () => xdr.ScSpecTypeDef.scSpecTypeString(),
  i128: () => xdr.ScSpecTypeDef.scSpecTypeI128(),
  bool: () => xdr.ScSpecTypeDef.scSpecTypeBool(),
  map: (keyType: xdr.ScSpecTypeDef, valueType: xdr.ScSpecTypeDef) =>
    xdr.ScSpecTypeDef.scSpecTypeMap(new xdr.ScSpecTypeMap({ keyType, valueType })),
  vec: (elementType: xdr.ScSpecTypeDef) =>
    xdr.ScSpecTypeDef.scSpecTypeVec(new xdr.ScSpecTypeVec({ elementType })),
  tuple: (valueTypes: xdr.ScSpecTypeDef[]) =>
    xdr.ScSpecTypeDef.scSpecTypeTuple(new xdr.ScSpecTypeTuple({ valueTypes })),
  udt: (name: string) => xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name })),
};

function structEntry(
  name: string,
  fields: { name: string; type: xdr.ScSpecTypeDef }[],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryUdtStructV0(
    new xdr.ScSpecUdtStructV0({
      doc: '',
      lib: '',
      name,
      fields: fields.map(
        (f) => new xdr.ScSpecUdtStructFieldV0({ doc: '', name: f.name, type: f.type }),
      ),
    }),
  );
}

function fnEntry(
  name: string,
  inputs: { name: string; type: xdr.ScSpecTypeDef }[],
  outputs: xdr.ScSpecTypeDef[] = [],
): xdr.ScSpecEntry {
  return xdr.ScSpecEntry.scSpecEntryFunctionV0(
    new xdr.ScSpecFunctionV0({
      doc: '',
      name,
      inputs: inputs.map(
        (i) => new xdr.ScSpecFunctionInputV0({ doc: '', name: i.name, type: i.type }),
      ),
      outputs,
    }),
  );
}

it('generates a Gen class with configure/batch methods and a typed Config struct', () => {
  const specEntries = [
    structEntry('Config', [
      { name: 'base_fee', type: t.i128() },
      { name: 'weights', type: t.map(t.string(), t.u32()) },
      { name: 'stages', type: t.vec(t.u32()) },
    ]),
    fnEntry('configure', [{ name: 'config', type: t.udt('Config') }], [t.bool()]),
    fnEntry('batch', [{ name: 'pair', type: t.tuple([t.u32(), t.string()]) }], [t.u32()]),
  ];

  const code = generateTypeScriptBindings(specEntries, { className: 'Gen' });

  expect(code).toContain('export class Gen');
  expect(code).toMatch(/\bconfigure\s*\(/);
  expect(code).toMatch(/\bbatch\s*\(/);
  expect(code).toMatch(/(interface|type|class)\s+Config\b/);
  expect(code).toMatch(/base_fee\s*:\s*bigint/);
  expect(code).toMatch(/weights\s*:\s*Map</);
  expect(code).toMatch(/stages\s*:\s*(Array<|\w+\[\])/);
});
