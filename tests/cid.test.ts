import {
  isValidCid,
  getCidVersion,
  assertValidCid,
  CID_V0_REGEX,
  CID_V1_REGEX,
} from '../src/storage/cid';
import { CidSchema } from '../src/schemas';
import { TrustFlowError } from '../src/errors';

// Helper function for encoding bytes to base58btc (for test construction)
function encodeBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];

  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }

  // Add leading zeros
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
    digits.push(0);
  }

  return digits.reverse().map(d => alphabet[d]).join('');
}

describe('CID validation utilities (#233, #445)', () => {
  const validV0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
  const validV0Another = 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco';
  const validV1Base32 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
  const validV1Base58 = 'zdj7Wn9FqaYvNfm9Zkp4eH84V33b2tNn918k6Qd2d2Ld2F1bA';

  // #445: Garbage CIDv1 base58btc with 41 bytes of 0xFF padding (invalid multihash)
  const garbageV1Base58 = 'zSSX8YzB3JHrjo6vdi3AMoi7zpc8f6DcGxmYpb6oWXDAsGJ2sQSQ7UGE';

  describe('isValidCid', () => {
    it('accepts valid CIDv0 strings', () => {
      expect(isValidCid(validV0)).toBe(true);
      expect(isValidCid(validV0Another)).toBe(true);
    });

    it('accepts valid CIDv1 strings', () => {
      expect(isValidCid(validV1Base32)).toBe(true);
      expect(isValidCid(validV1Base58)).toBe(true);
    });

    it('rejects path traversal and slashes', () => {
      expect(isValidCid(`../${validV0}`)).toBe(false);
      expect(isValidCid(`ipfs/${validV0}`)).toBe(false);
      expect(isValidCid(`${validV1Base32}/sub/path`)).toBe(false);
      expect(isValidCid(`..\\${validV1Base32}`)).toBe(false);
    });

    it('rejects whitespace and invalid characters', () => {
      expect(isValidCid(` ${validV0} `)).toBe(false);
      expect(isValidCid('')).toBe(false);
      expect(isValidCid('not-a-cid')).toBe(false);
      expect(isValidCid(123 as any)).toBe(false);
    });

    describe('Boundary Tests', () => {
      it('rejects 49-char CIDv1 base32 as too short (#625)', () => {
        // Construct a 49-char string: b + 48 valid base32 chars (all 'a')
        const tooShort = 'b' + 'a'.repeat(48);
        expect(tooShort.length).toBe(49);
        expect(isValidCid(tooShort)).toBe(false); // Rejected by length check
      });

      it('accepts 50-char CIDv1 base32 if structurally valid (#625)', () => {
        // Use the known valid CIDv1 base32 which is at least 50 chars
        expect(isValidCid(validV1Base32)).toBe(true);
        expect(validV1Base32.length).toBeGreaterThanOrEqual(50);
      });
    });

    describe('#445: base58btc structural validation', () => {
      it('rejects CIDv1 base58btc with garbage multihash payload', () => {
        // This CID has valid base58btc encoding and version byte (0x01),
        // but the post-version-byte payload is 41 bytes of 0xFF padding
        // (not a valid multicodec varint or multihash header)
        expect(isValidCid(garbageV1Base58)).toBe(false);
      });

      it('accepts well-formed CIDv1 base58btc with real sha2-256 multihash', () => {
        // This CID has proper CIDv1 structure: version + multicodec + multihash
        expect(isValidCid(validV1Base58)).toBe(true);
      });

      it('rejects CIDv1 base58btc with truncated multihash', () => {
        // CIDv1 version byte + multicodec but no complete multihash
        // (too short to contain valid multihash header + digest)
        const truncated = 'z4HFzY'; // Less than minimum valid CID length
        expect(isValidCid(truncated)).toBe(false);
      });

      it('rejects CIDv1 base58btc with mismatched multihash length', () => {
        // Create a CID with sha2-256 function code (0x12) but wrong length byte
        // This constructs: version(0x01) + multicodec(0x55=raw) + hash(0x12) + length(0x10=16 bytes) + 16 zero bytes
        // sha2-256 (0x12) must have length 0x20 (32 bytes), so this should fail
        const bytes = new Uint8Array([
          0x01, // CIDv1
          0x55, // multicodec: raw
          0x12, // multihash function: sha2-256
          0x10, // length: 16 (WRONG - should be 32 for sha2-256)
          ...new Array(16).fill(0), // 16 zero bytes
        ]);
        const base58Encoded = encodeBase58(bytes);
        expect(isValidCid('z' + base58Encoded)).toBe(false);
      });
    });
  });

  describe('base32 and base58btc consistency (#445)', () => {
    it('enforces the same structural checks in both branches', () => {
      // Both branches should reject CIDs with invalid multihash structures
      // The base32 branch was already correct; base58btc now matches it

      // Test with various malformed structures
      const tests = [
        { desc: 'garbage payload', cid: garbageV1Base58, expected: false },
        { desc: 'valid structure', cid: validV1Base58, expected: true },
      ];

      tests.forEach(({ desc, cid, expected }) => {
        expect(isValidCid(cid)).toBe(expected);
      });
    });
  });

  describe('fuzz: random post-version-byte payloads (#445)', () => {
    it('rejects random payloads that do not decode to valid multicodec/multihash', () => {
      // Generate random payloads and verify they are rejected
      // (unless they accidentally form a valid structure, which is extremely unlikely)
      let rejectedCount = 0;
      const iterations = 50;

      for (let i = 0; i < iterations; i++) {
        // Create random bytes: version byte + random payload
        const randomLength = 10 + Math.floor(Math.random() * 30);
        const bytes = new Uint8Array(randomLength);
        bytes[0] = 0x01; // CIDv1 version byte

        // Fill rest with random bytes
        for (let j = 1; j < randomLength; j++) {
          bytes[j] = Math.floor(Math.random() * 256);
        }

        const encoded = encodeBase58(bytes);
        const cid = 'z' + encoded;

        // Most random payloads should fail validation
        // (valid multicodec varint + valid multihash structure is rare)
        if (!isValidCid(cid)) {
          rejectedCount++;
        }
      }

      // Expect vast majority to be rejected (at least 90%)
      expect(rejectedCount).toBeGreaterThan(iterations * 0.9);
    });

    it('constructs and validates properly-formed synthetic CIDs', () => {
      // Construct a valid CIDv1 base58btc: version + multicodec + multihash
      const bytes = new Uint8Array([
        0x01, // CIDv1
        0x55, // multicodec: raw (single-byte varint)
        0x12, // multihash function: sha2-256
        0x20, // length: 32 bytes (correct for sha2-256)
        ...new Array(32).fill(0xAB), // 32 bytes of 0xAB as digest
      ]);

      const encoded = encodeBase58(bytes);
      const cid = 'z' + encoded;

      // This should pass validation
      expect(isValidCid(cid)).toBe(true);
    });
  });

  describe('getCidVersion', () => {
    it('returns 0 for CIDv0', () => {
      expect(getCidVersion(validV0)).toBe(0);
      expect(getCidVersion(validV0Another)).toBe(0);
    });

    it('returns 1 for CIDv1', () => {
      expect(getCidVersion(validV1Base32)).toBe(1);
      expect(getCidVersion(validV1Base58)).toBe(1);
    });

    it('returns null for invalid CIDs', () => {
      expect(getCidVersion('invalid')).toBe(null);
      expect(getCidVersion('')).toBe(null);
      expect(getCidVersion(`../${validV0}`)).toBe(null);
    });
  });

  describe('assertValidCid', () => {
    it('does not throw for valid CID', () => {
      expect(() => assertValidCid(validV0)).not.toThrow();
      expect(() => assertValidCid(validV1Base32, 'evidenceCid')).not.toThrow();
    });

    it('throws TrustFlowError with VALIDATION_ERROR and field name', () => {
      try {
        assertValidCid('invalid', 'myField');
        throw new Error('should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(TrustFlowError);
        expect(err.code).toBe('VALIDATION_ERROR');
        expect(err.field).toBe('myField');
      }
    });
  });

  describe('CidSchema (Zod)', () => {
    it('parses valid CIDs', () => {
      expect(CidSchema.safeParse(validV0).success).toBe(true);
      expect(CidSchema.safeParse(validV1Base32).success).toBe(true);
    });

    it('rejects invalid CIDs with a helpful error message', () => {
      const result = CidSchema.safeParse('not-valid');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('CID');
      }
    });
  });
});
