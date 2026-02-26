import { describe, expect, it } from 'vitest';
import { normalizeErrorPayload } from '../src/routes';

describe('normalizeErrorPayload', () => {
  it('passes through success responses (ok: true) unchanged', () => {
    const payload = { ok: true, data: 'result' };
    expect(normalizeErrorPayload(payload, 200)).toEqual(payload);
  });

  it('passes through non-object values unchanged', () => {
    expect(normalizeErrorPayload(null, 200)).toBeNull();
    expect(normalizeErrorPayload('string', 400)).toBe('string');
    expect(normalizeErrorPayload([1, 2], 400)).toEqual([1, 2]);
    expect(normalizeErrorPayload(42, 400)).toBe(42);
  });

  it('adds error_code and message to error responses', () => {
    const payload = { ok: false, error: 'nonce_reused' };
    const result = normalizeErrorPayload(payload, 409) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(result.error_code).toBe('nonce_reused');
    expect(typeof result.message).toBe('string');
    expect((result.message as string).length).toBeGreaterThan(0);
  });

  it('preserves the legacy error field for backward compatibility', () => {
    const payload = { ok: false, error: 'my_legacy_code' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;

    expect(result.error).toBe('my_legacy_code');
    expect(result.error_code).toBe('my_legacy_code');
  });

  it('sets legacy error field from error_code when error is absent', () => {
    const payload = { ok: false, error_code: 'new_code' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;

    expect(result.error).toBe('new_code');
    expect(result.error_code).toBe('new_code');
  });

  it('aliases error_details to details when details is not present', () => {
    const payload = { ok: false, error: 'bad_request', error_details: { field: 'name' } };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;

    expect(result.details).toEqual({ field: 'name' });
    expect(result.error_details).toEqual({ field: 'name' });
  });

  it('does not overwrite an existing details field with error_details', () => {
    const payload = { ok: false, error: 'bad_request', details: 'original', error_details: 'other' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;

    expect(result.details).toBe('original');
  });

  it('uses provided message if present and non-empty', () => {
    const payload = { ok: false, error: 'custom_error', message: 'Custom message here.' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;

    expect(result.message).toBe('Custom message here.');
  });

  it('generates default message for 401 status', () => {
    const payload = { ok: false, error: 'unauthorized' };
    const result = normalizeErrorPayload(payload, 401) as Record<string, unknown>;

    expect(result.message).toBe('Authentication failed.');
  });

  it('generates default message for 403 status', () => {
    const payload = { ok: false, error: 'forbidden' };
    const result = normalizeErrorPayload(payload, 403) as Record<string, unknown>;

    expect(result.message).toBe('Access forbidden for this capability.');
  });

  it('generates default message for 404 status', () => {
    const payload = { ok: false, error: 'not_found' };
    const result = normalizeErrorPayload(payload, 404) as Record<string, unknown>;

    expect(result.message).toBe('Requested route or resource was not found.');
  });

  it('generates default message for 409 status', () => {
    const payload = { ok: false, error: 'conflict' };
    const result = normalizeErrorPayload(payload, 409) as Record<string, unknown>;

    expect(result.message).toBe('Conflict detected for this request.');
  });

  it('generates default message for 5xx status', () => {
    const payload = { ok: false, error: 'internal' };
    const result = normalizeErrorPayload(payload, 500) as Record<string, unknown>;

    expect(result.message).toBe('Control plane encountered an internal error.');
  });

  it('generates default message for other 4xx status', () => {
    const payload = { ok: false, error: 'bad_request' };
    const result = normalizeErrorPayload(payload, 422) as Record<string, unknown>;

    expect(result.message).toBe('Request validation failed.');
  });

  it('uses unknown_error as error_code when error fields are absent', () => {
    const payload = { ok: false };
    const result = normalizeErrorPayload(payload, 500) as Record<string, unknown>;

    expect(result.error_code).toBe('unknown_error');
    expect(result.error).toBe('unknown_error');
  });
});
