import { describe, expect, it } from 'vitest';
import { normalizeErrorPayload } from '../src/routes';

describe('normalizeErrorPayload', () => {
  it('passes success responses through unchanged', () => {
    const payload = { ok: true, data: { id: 1 } };
    expect(normalizeErrorPayload(payload, 200)).toStrictEqual(payload);
  });

  it('passes through non-object payloads unchanged', () => {
    expect(normalizeErrorPayload(null, 400)).toBeNull();
    expect(normalizeErrorPayload('error string', 400)).toBe('error string');
    expect(normalizeErrorPayload([1, 2, 3], 400)).toStrictEqual([1, 2, 3]);
  });

  it('adds error_code and message fields to error responses', () => {
    const payload = { ok: false, error_code: 'rate_limited' };
    const result = normalizeErrorPayload(payload, 429) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe('rate_limited');
    expect(typeof result.message).toBe('string');
    expect((result.message as string).length).toBeGreaterThan(0);
  });

  it('preserves explicit message when provided', () => {
    const payload = { ok: false, error_code: 'bad_input', message: 'field x is required' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.message).toBe('field x is required');
    expect(result.error_code).toBe('bad_input');
  });

  it('preserves legacy error field when already present', () => {
    const payload = { ok: false, error: 'legacy_err', error_code: 'legacy_err' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error).toBe('legacy_err');
  });

  it('adds legacy error field when not present', () => {
    const payload = { ok: false, error_code: 'some_error' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error).toBe('some_error');
  });

  it('derives error_code from legacy error field when error_code is absent', () => {
    const payload = { ok: false, error: 'old_error_code' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error_code).toBe('old_error_code');
    expect(result.error).toBe('old_error_code');
  });

  it('aliases error_details to details when details is not present', () => {
    const details = { field: 'email', constraint: 'format' };
    const payload = { ok: false, error_code: 'validation_error', error_details: details };
    const result = normalizeErrorPayload(payload, 422) as Record<string, unknown>;
    expect(result.details).toStrictEqual(details);
    expect(result.error_details).toStrictEqual(details);
  });

  it('does not overwrite details with error_details when details is already present', () => {
    const existing = { field: 'name' };
    const other = { field: 'email' };
    const payload = { ok: false, error_code: 'validation_error', details: existing, error_details: other };
    const result = normalizeErrorPayload(payload, 422) as Record<string, unknown>;
    expect(result.details).toStrictEqual(existing);
  });

  it('returns default message for 401', () => {
    const payload = { ok: false, error_code: 'auth_failed' };
    const result = normalizeErrorPayload(payload, 401) as Record<string, unknown>;
    expect(result.message).toBe('Authentication failed.');
  });

  it('returns default message for 403', () => {
    const payload = { ok: false, error_code: 'forbidden' };
    const result = normalizeErrorPayload(payload, 403) as Record<string, unknown>;
    expect(result.message).toBe('Access forbidden for this capability.');
  });

  it('returns default message for 404', () => {
    const payload = { ok: false, error_code: 'not_found' };
    const result = normalizeErrorPayload(payload, 404) as Record<string, unknown>;
    expect(result.message).toBe('Requested route or resource was not found.');
  });

  it('returns default message for 409', () => {
    const payload = { ok: false, error_code: 'conflict' };
    const result = normalizeErrorPayload(payload, 409) as Record<string, unknown>;
    expect(result.message).toBe('Conflict detected for this request.');
  });

  it('returns default message for 5xx', () => {
    const payload = { ok: false, error_code: 'internal' };
    const result = normalizeErrorPayload(payload, 500) as Record<string, unknown>;
    expect(result.message).toBe('Control plane encountered an internal error.');
  });

  it('returns default message for other 4xx', () => {
    const payload = { ok: false, error_code: 'bad_request' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.message).toBe('Request validation failed.');
  });

  it('uses unknown_error code when error_code is missing and error is blank', () => {
    const payload = { ok: false };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error_code).toBe('unknown_error');
  });
});
