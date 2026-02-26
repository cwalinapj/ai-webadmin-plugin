import { describe, expect, it } from 'vitest';
import { defaultErrorMessage, normalizeErrorPayload } from '../src/routes';

describe('normalizeErrorPayload', () => {
  it('passes through success responses (ok: true) unchanged', () => {
    const payload = { ok: true, data: { id: 1 } };
    expect(normalizeErrorPayload(payload, 200)).toBe(payload);
  });

  it('passes through non-object payloads unchanged', () => {
    expect(normalizeErrorPayload(null, 400)).toBeNull();
    expect(normalizeErrorPayload('string', 400)).toBe('string');
    expect(normalizeErrorPayload([1, 2], 400)).toEqual([1, 2]);
  });

  it('adds error_code and message to error responses', () => {
    const payload = { ok: false };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error_code).toBe('unknown_error');
    expect(result.message).toBe('Request validation failed.');
  });

  it('uses existing error_code when present', () => {
    const payload = { ok: false, error_code: 'my_error' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error_code).toBe('my_error');
  });

  it('preserves legacy error field for backward compatibility', () => {
    const payload = { ok: false, error: 'my_error' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error).toBe('my_error');
    expect(result.error_code).toBe('my_error');
  });

  it('adds legacy error field derived from error_code when not present', () => {
    const payload = { ok: false, error_code: 'new_code' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.error).toBe('new_code');
  });

  it('aliases error_details to details when details is not present', () => {
    const payload = { ok: false, error_details: { field: 'name' } };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.details).toEqual({ field: 'name' });
  });

  it('does not override details when already present', () => {
    const existing = { field: 'existing' };
    const payload = { ok: false, details: existing, error_details: { field: 'other' } };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.details).toBe(existing);
  });

  it('uses existing message when provided', () => {
    const payload = { ok: false, message: 'custom message' };
    const result = normalizeErrorPayload(payload, 400) as Record<string, unknown>;
    expect(result.message).toBe('custom message');
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

  it('returns internal error message for 5xx status codes', () => {
    expect(defaultErrorMessage('server_error', 500)).toBe('Control plane encountered an internal error.');
    expect(defaultErrorMessage('server_error', 503)).toBe('Control plane encountered an internal error.');
  });

  it('returns validation failed message for other 4xx status codes', () => {
    expect(defaultErrorMessage('bad_request', 400)).toBe('Request validation failed.');
    expect(defaultErrorMessage('bad_request', 422)).toBe('Request validation failed.');
  });

  it('returns humanized error code for non-error status codes', () => {
    expect(defaultErrorMessage('my_custom_code', 200)).toBe('my custom code');
  });
});
