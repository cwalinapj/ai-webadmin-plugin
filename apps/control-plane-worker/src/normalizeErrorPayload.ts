export function normalizeErrorPayload(payload: unknown, status: number): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  const record = payload as Record<string, unknown>;
  if (record.ok !== false) {
    return payload;
  }

  const rawCode = record.error_code ?? record.error;
  const errorCode =
    typeof rawCode === 'string' && rawCode.trim() !== '' ? rawCode.trim() : 'unknown_error';
  const rawMessage = record.message;
  const message =
    typeof rawMessage === 'string' && rawMessage.trim() !== ''
      ? rawMessage.trim()
      : defaultErrorMessage(errorCode, status);

  const normalized: Record<string, unknown> = {
    ...record,
    ok: false,
    error_code: errorCode,
    message,
  };

  if (!('details' in normalized) && 'error_details' in normalized) {
    normalized.details = normalized.error_details;
  }

  if (!('error' in normalized)) {
    normalized.error = errorCode;
  }

  return normalized;
}

export function defaultErrorMessage(errorCode: string, status: number): string {
  if (status === 401) {
    return 'Authentication failed.';
  }
  if (status === 403) {
    return 'Access forbidden for this capability.';
  }
  if (status === 404) {
    return 'Requested route or resource was not found.';
  }
  if (status === 409) {
    return 'Conflict detected for this request.';
  }
  if (status >= 500) {
    return 'Control plane encountered an internal error.';
  }
  if (status >= 400) {
    return 'Request validation failed.';
  }

  return errorCode.replace(/_/g, ' ');
}
