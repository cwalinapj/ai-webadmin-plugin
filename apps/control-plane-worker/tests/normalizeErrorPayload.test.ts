import { describe, expect, it } from 'vitest';
import { defaultErrorMessage, normalizeErrorPayload } from '../src/normalizeErrorPayload';

describe('normalizeErrorPayload', () => {
  it('passes through null unchanged', () => {
    expect(normalizeErrorPayload(null, 400)).toBeNull();
  });

  it('passes through a string unchanged', () => {
    expect(normalizeErrorPayload('plain string', 400)).toBe('plain string');
  });

  it('passes through an array unchanged', () => {
    const arr = [1, 2, 3];
    expect(normalizeErrorPayload(arr, 400)).toBe(arr);
  });

  it('passes through success response (ok: true) unchanged', () => {
    const payload = { ok: true, data: 'some data' };
    expect(normalizeErrorPayload(payload, 200)).toBe(payload);
  });

  it('passes through response without ok field unchanged', () => {
    const payload = { data: 'no ok field' };
    expect(normalizeErrorPayload(payload, 200)).toBe(payload);
  });

  it('adds error_code and message to error response', () => {
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'not_found' },
      404,
    ) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(result.error_code).toBe('not_found');
    expect(result.message).toBe('Requested route or resource was not found.');
  });

  it('preserves provided message when present', () => {
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'rate_limited', message: 'Too many requests.' },
      429,
    ) as Record<string, unknown>;
    expect(result.message).toBe('Too many requests.');
  });

  it('falls back to unknown_error when error_code and error are both missing', () => {
    const result = normalizeErrorPayload({ ok: false }, 400) as Record<string, unknown>;
    expect(result.error_code).toBe('unknown_error');
    expect(result.error).toBe('unknown_error');
  });

  it('uses error field as error_code fallback when error_code is absent', () => {
    const result = normalizeErrorPayload(
      { ok: false, error: 'legacy_error' },
      400,
    ) as Record<string, unknown>;
    expect(result.error_code).toBe('legacy_error');
    expect(result.error).toBe('legacy_error');
  });

  it('preserves legacy error field when already present', () => {
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'auth_failed', error: 'auth_failed' },
      401,
    ) as Record<string, unknown>;
    expect(result.error).toBe('auth_failed');
  });

  it('sets error to error_code when error field is absent', () => {
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'not_found' },
      404,
    ) as Record<string, unknown>;
    expect(result.error).toBe('not_found');
  });

  it('aliases error_details to details when details is absent', () => {
    const details = { field: 'site_url', reason: 'invalid' };
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'validation_error', error_details: details },
      400,
    ) as Record<string, unknown>;
    expect(result.details).toBe(details);
    expect(result.error_details).toBe(details);
  });

  it('does not overwrite details when it is already present', () => {
    const existingDetails = { field: 'id' };
    const otherDetails = { field: 'name' };
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'conflict', details: existingDetails, error_details: otherDetails },
      409,
    ) as Record<string, unknown>;
    expect(result.details).toBe(existingDetails);
  });

  it('trims whitespace from error_code', () => {
    const result = normalizeErrorPayload(
      { ok: false, error_code: '  trimmed_code  ' },
      400,
    ) as Record<string, unknown>;
    expect(result.error_code).toBe('trimmed_code');
  });

  it('trims whitespace from message', () => {
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'some_error', message: '  trimmed message  ' },
      400,
    ) as Record<string, unknown>;
    expect(result.message).toBe('trimmed message');
  });
});

describe('defaultErrorMessage', () => {
  it('returns authentication message for status 401', () => {
    expect(defaultErrorMessage('auth_failed', 401)).toBe('Authentication failed.');
  });

  it('returns forbidden message for status 403', () => {
    expect(defaultErrorMessage('forbidden', 403)).toBe('Access forbidden for this capability.');
  });

  it('returns not found message for status 404', () => {
    expect(defaultErrorMessage('not_found', 404)).toBe('Requested route or resource was not found.');
  });

  it('returns conflict message for status 409', () => {
    expect(defaultErrorMessage('conflict', 409)).toBe('Conflict detected for this request.');
  });

  it('returns internal error message for status 500', () => {
    expect(defaultErrorMessage('internal_error', 500)).toBe(
      'Control plane encountered an internal error.',
    );
  });

  it('returns internal error message for status 503', () => {
    expect(defaultErrorMessage('service_unavailable', 503)).toBe(
      'Control plane encountered an internal error.',
    );
  });

  it('returns validation failed message for status 400', () => {
    expect(defaultErrorMessage('bad_request', 400)).toBe('Request validation failed.');
  });

  it('returns validation failed message for status 422', () => {
    expect(defaultErrorMessage('unprocessable', 422)).toBe('Request validation failed.');
  });

  it('returns humanized error code for non-error status', () => {
    expect(defaultErrorMessage('some_custom_code', 200)).toBe('some custom code');
  });
});
