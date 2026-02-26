import { describe, expect, it } from 'vitest';
import { defaultErrorMessage, normalizeErrorPayload } from '../src/routes';

describe('normalizeErrorPayload', () => {
  it('passes success responses through unchanged', () => {
    const payload = { ok: true, data: { id: 1 } };
    expect(normalizeErrorPayload(payload, 200)).toEqual(payload);
  });

  it('passes through non-object payloads unchanged', () => {
    expect(normalizeErrorPayload(null, 400)).toBeNull();
    expect(normalizeErrorPayload('string', 400)).toBe('string');
    expect(normalizeErrorPayload([1, 2], 400)).toEqual([1, 2]);
  });

  it('adds error_code and message to error responses', () => {
    const payload = { ok: false, error_code: 'not_found' };
    const result = normalizeErrorPayload(payload, 404) as Record<string, unknown>;
    expect(result.error_code).toBe('not_found');
    expect(result.message).toBe('Requested route or resource was not found.');
  });

  it('preserves the legacy error field if present', () => {
    const payload = { ok: false, error: 'original_error' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error).toBe('original_error');
    expect(result.error_code).toBe('original_error');
  });

  it('sets legacy error field from error_code when error is absent', () => {
    const payload = { ok: false, error_code: 'rate_limited' };
    const result = normalizeErrorPayload(payload, 429) as Record<string, unknown>;
    expect(result.error).toBe('rate_limited');
  });

  it('aliases error_details to details when details is not present', () => {
    const payload = { ok: false, error_details: { field: 'email' } };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.details).toEqual({ field: 'email' });
    expect(result.error_details).toEqual({ field: 'email' });
  });

  it('does not overwrite details with error_details when details is already present', () => {
    const payload = { ok: false, details: { existing: true }, error_details: { field: 'email' } };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.details).toEqual({ existing: true });
  });

  it('uses provided message when present', () => {
    const payload = { ok: false, message: 'custom error message' };
    const result = normalizeErrorPayload(payload, 500) as Record<string, unknown>;
    expect(result.message).toBe('custom error message');
  });

  it('uses unknown_error when error_code and error are both absent', () => {
    const payload = { ok: false };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error_code).toBe('unknown_error');
    expect(result.error).toBe('unknown_error');
  });
});

describe('defaultErrorMessage', () => {
  it('returns authentication message for 401', () => {
    expect(defaultErrorMessage('auth_failed', 401)).toBe('Authentication failed.');
  });

  it('returns forbidden message for 403', () => {
    expect(defaultErrorMessage('forbidden', 403)).toBe('Access forbidden for this capability.');
  });

  it('returns not found message for 404', () => {
    expect(defaultErrorMessage('not_found', 404)).toBe('Requested route or resource was not found.');
  });

  it('returns conflict message for 409', () => {
    expect(defaultErrorMessage('conflict', 409)).toBe('Conflict detected for this request.');
  });

  it('returns internal error message for 5xx', () => {
    expect(defaultErrorMessage('crash', 500)).toBe('Control plane encountered an internal error.');
    expect(defaultErrorMessage('crash', 503)).toBe('Control plane encountered an internal error.');
  });

  it('returns request validation message for other 4xx', () => {
    expect(defaultErrorMessage('bad_input', 422)).toBe('Request validation failed.');
    expect(defaultErrorMessage('bad_input', 400)).toBe('Request validation failed.');
  });

  it('returns humanized error code for non-error statuses', () => {
    expect(defaultErrorMessage('some_code', 200)).toBe('some code');
  });
});
