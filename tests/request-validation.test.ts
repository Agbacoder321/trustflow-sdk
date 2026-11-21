import {
  DEFAULT_MAX_JSON_LENGTH,
  DEFAULT_MAX_REQUEST_SIZE,
  getJsonSizeBytes,
  isRequestSizeValid,
  validateRequestSize,
} from '../src/utils/request-validation';

describe('request validation size limits (#620)', () => {
  it('rejects a body over a configured maxJsonLength even when the byte limit is large', () => {
    const body = { payload: 'x'.repeat(200) };

    expect(() =>
      validateRequestSize(body, {
        maxJsonLength: 100,
        maxRequestSizeBytes: DEFAULT_MAX_REQUEST_SIZE,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: expect.stringContaining('Request JSON length'),
      }),
    );
  });

  it('accepts the same body when maxJsonLength is raised', () => {
    const body = { payload: 'x'.repeat(200) };

    expect(() => validateRequestSize(body, { maxJsonLength: 1000 })).not.toThrow();
    expect(isRequestSizeValid(body, { maxJsonLength: 1000 })).toBe(true);
  });

  it('enforces the exported default JSON length limit', () => {
    const body = { payload: 'x'.repeat(DEFAULT_MAX_JSON_LENGTH) };

    expect(DEFAULT_MAX_JSON_LENGTH).toBeLessThan(DEFAULT_MAX_REQUEST_SIZE);
    expect(isRequestSizeValid(body, { maxRequestSizeBytes: 100 * 1024 * 1024 })).toBe(false);
  });

  it('checks UTF-8 byte size independently of JSON string length', () => {
    const body = { payload: 'é'.repeat(100) };

    expect(getJsonSizeBytes(body)).toBeGreaterThan(JSON.stringify(body).length);
    expect(isRequestSizeValid(body, { maxJsonLength: 1000, maxRequestSizeBytes: 150 })).toBe(false);
    expect(isRequestSizeValid(body, { maxJsonLength: 1000, maxRequestSizeBytes: 1024 })).toBe(true);
  });

  it('still rejects non-serializable bodies with VALIDATION_ERROR', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => validateRequestSize(circular)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() => getJsonSizeBytes(undefined)).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
  });
});
