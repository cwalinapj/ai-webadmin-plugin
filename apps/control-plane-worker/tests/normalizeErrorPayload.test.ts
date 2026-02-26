import { describe, expect, it } from 'vitest';
import { normalizeErrorPayload } from '../src/routes';

describe('normalizeErrorPayload', () => {
  it('passes through success responses unchanged', () => {
    const payload = { ok: true, data: { id: 'site-1' } };
    expect(normalizeErrorPayload(payload, 200)).toEqual(payload);
  });

  it('passes through non-object payloads unchanged', () => {
    expect(normalizeErrorPayload(null, 400)).toBeNull();
    expect(normalizeErrorPayload('error string', 400)).toBe('error string');
    expect(normalizeErrorPayload([{ ok: false }], 400)).toEqual([{ ok: false }]);
  });

  it('adds error_code and message to error responses', () => {
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'site_not_found' },
      404,
    ) as Record<string, unknown>;
    expect(result.error_code).toBe('site_not_found');
    expect(result.message).toBe('Requested route or resource was not found.');
  });

  it('preserves existing message when present', () => {
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'bad_input', message: 'Field is required.' },
      400,
    ) as Record<string, unknown>;
    expect(result.message).toBe('Field is required.');
  });

  it('preserves legacy error field when already present', () => {
    const result = normalizeErrorPayload(
      { ok: false, error: 'legacy_code', error_code: 'new_code' },
      400,
    ) as Record<string, unknown>;
    expect(result.error).toBe('legacy_code');
    expect(result.error_code).toBe('new_code');
  });

  it('sets error field to error_code when error is absent', () => {
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'quota_exceeded' },
      400,
    ) as Record<string, unknown>;
    expect(result.error).toBe('quota_exceeded');
  });

  it('falls back to error field as error_code when error_code is absent', () => {
    const result = normalizeErrorPayload(
      { ok: false, error: 'legacy_only' },
      400,
    ) as Record<string, unknown>;
    expect(result.error_code).toBe('legacy_only');
    expect(result.error).toBe('legacy_only');
  });

  it('aliases error_details to details when details is absent', () => {
    const details = [{ field: 'email', issue: 'invalid' }];
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'validation_error', error_details: details },
      400,
    ) as Record<string, unknown>;
    expect(result.details).toEqual(details);
    expect(result.error_details).toEqual(details);
  });

  it('does not overwrite existing details with error_details', () => {
    const existing = { summary: 'already set' };
    const result = normalizeErrorPayload(
      { ok: false, error_code: 'validation_error', details: existing, error_details: [1, 2] },
      400,
    ) as Record<string, unknown>;
    expect(result.details).toEqual(existing);
  });

  it('uses unknown_error code when error_code and error are both absent', () => {
    const result = normalizeErrorPayload({ ok: false }, 400) as Record<string, unknown>;
    expect(result.error_code).toBe('unknown_error');
    expect(result.error).toBe('unknown_error');
  });

  describe('defaultErrorMessage', () => {
    it('returns 401 message for status 401', () => {
      const result = normalizeErrorPayload(
        { ok: false, error_code: 'unauthorized' },
        401,
      ) as Record<string, unknown>;
      expect(result.message).toBe('Authentication failed.');
    });

    it('returns 403 message for status 403', () => {
      const result = normalizeErrorPayload(
        { ok: false, error_code: 'forbidden' },
        403,
      ) as Record<string, unknown>;
      expect(result.message).toBe('Access forbidden for this capability.');
    });

    it('returns 404 message for status 404', () => {
      const result = normalizeErrorPayload(
        { ok: false, error_code: 'not_found' },
        404,
      ) as Record<string, unknown>;
      expect(result.message).toBe('Requested route or resource was not found.');
    });

    it('returns 409 message for status 409', () => {
      const result = normalizeErrorPayload(
        { ok: false, error_code: 'conflict' },
        409,
      ) as Record<string, unknown>;
      expect(result.message).toBe('Conflict detected for this request.');
    });

    it('returns 5xx message for status >= 500', () => {
      const result = normalizeErrorPayload(
        { ok: false, error_code: 'internal' },
        500,
      ) as Record<string, unknown>;
      expect(result.message).toBe('Control plane encountered an internal error.');
    });

    it('returns 4xx message for other 4xx status codes', () => {
      const result = normalizeErrorPayload(
        { ok: false, error_code: 'bad_request' },
        422,
      ) as Record<string, unknown>;
      expect(result.message).toBe('Request validation failed.');
    });

    it('falls back to humanized error_code for non-error status', () => {
      const result = normalizeErrorPayload(
        { ok: false, error_code: 'some_code' },
        200,
      ) as Record<string, unknown>;
      expect(result.message).toBe('some code');
    });
  });
});
