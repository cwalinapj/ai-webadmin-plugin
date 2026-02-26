import { describe, expect, it } from 'vitest';
import { normalizeErrorPayload } from '../src/routes';

describe('normalizeErrorPayload', () => {
  it('passes through success responses (ok: true) unchanged', () => {
    const payload = { ok: true, data: 'value' };
    expect(normalizeErrorPayload(payload, 200)).toEqual(payload);
  });

  it('passes through non-object payloads unchanged', () => {
    expect(normalizeErrorPayload('string', 400)).toBe('string');
    expect(normalizeErrorPayload(null, 400)).toBeNull();
    expect(normalizeErrorPayload([1, 2], 400)).toEqual([1, 2]);
  });

  it('adds error_code and message fields to error responses', () => {
    const payload = { ok: false, error: 'not_found' };
    const result = normalizeErrorPayload(payload, 404) as Record<string, unknown>;
    expect(result.error_code).toBe('not_found');
    expect(result.message).toBe('Requested route or resource was not found.');
  });

  it('preserves legacy error field for backward compatibility', () => {
    const payload = { ok: false, error: 'unauthorized' };
    const result = normalizeErrorPayload(payload, 401) as Record<string, unknown>;
    expect(result.error).toBe('unauthorized');
  });

  it('adds legacy error field when not present', () => {
    const payload = { ok: false, error_code: 'some_code' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error).toBe('some_code');
  });

  it('aliases error_details to details when details is not present', () => {
    const payload = { ok: false, error: 'fail', error_details: { field: 'name' } };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.details).toEqual({ field: 'name' });
  });

  it('does not overwrite existing details field', () => {
    const payload = { ok: false, error: 'fail', details: 'original', error_details: 'other' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.details).toBe('original');
  });

  it('uses error_code field over error field when both present', () => {
    const payload = { ok: false, error: 'old_error', error_code: 'new_code' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error_code).toBe('new_code');
  });

  it('uses provided message when present', () => {
    const payload = { ok: false, error: 'fail', message: 'Custom message' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.message).toBe('Custom message');
  });

  it('generates default message for 401', () => {
    const result = normalizeErrorPayload({ ok: false }, 401) as Record<string, unknown>;
    expect(result.message).toBe('Authentication failed.');
  });

  it('generates default message for 403', () => {
    const result = normalizeErrorPayload({ ok: false }, 403) as Record<string, unknown>;
    expect(result.message).toBe('Access forbidden for this capability.');
  });

  it('generates default message for 404', () => {
    const result = normalizeErrorPayload({ ok: false }, 404) as Record<string, unknown>;
    expect(result.message).toBe('Requested route or resource was not found.');
  });

  it('generates default message for 409', () => {
    const result = normalizeErrorPayload({ ok: false }, 409) as Record<string, unknown>;
    expect(result.message).toBe('Conflict detected for this request.');
  });

  it('generates default message for 5xx', () => {
    const result = normalizeErrorPayload({ ok: false }, 500) as Record<string, unknown>;
    expect(result.message).toBe('Control plane encountered an internal error.');
  });

  it('generates default message for other 4xx', () => {
    const result = normalizeErrorPayload({ ok: false }, 422) as Record<string, unknown>;
    expect(result.message).toBe('Request validation failed.');
  });

  it('generates humanized default message for unrecognized status using error_code', () => {
    const result = normalizeErrorPayload({ ok: false, error: 'some_code' }, 200) as Record<string, unknown>;
    expect(result.message).toBe('some code');
  });

  it('uses unknown_error when error code is empty string', () => {
    const result = normalizeErrorPayload({ ok: false, error: '' }, 400) as Record<string, unknown>;
    expect(result.error_code).toBe('unknown_error');
  });
});
