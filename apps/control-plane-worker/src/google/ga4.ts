export async function ensureGa4Conversions(
  accessToken: string,
  propertyId: string,
  events: string[],
): Promise<Record<string, unknown>> {
  if (!propertyId) {
    return {
      status: 'skipped',
      reason: 'missing_ga4_property_id',
    };
  }

  const uniqueEvents = Array.from(
    new Set(
      events
        .map((value) => normalizeEventName(value))
        .filter((value) => value.length > 0),
    ),
  );

  const existing = await listConversionEvents(accessToken, propertyId);
  const existingSet = new Set(existing);

  const created: string[] = [];
  const skipped: string[] = [];
  const errors: Array<Record<string, string>> = [];

  for (const event of uniqueEvents) {
    if (existingSet.has(event)) {
      skipped.push(event);
      continue;
    }

    try {
      await createConversionEvent(accessToken, propertyId, event);
      created.push(event);
    } catch (error) {
      errors.push({
        event,
        error: error instanceof Error ? error.message : 'unknown_error',
      });
    }
  }

  return {
    status: errors.length > 0 ? 'partial' : 'ok',
    created,
    skipped,
    errors,
  };
}

async function listConversionEvents(accessToken: string, propertyId: string): Promise<string[]> {
  const response = await fetch(
    `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/conversionEvents`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`ga4_list_conversions_failed:${response.status}:${truncate(text)}`);
  }

  let parsed: { conversionEvents?: Array<{ eventName?: string }> };
  try {
    parsed = JSON.parse(text) as { conversionEvents?: Array<{ eventName?: string }> };
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.conversionEvents)) {
    return [];
  }

  return parsed.conversionEvents
    .map((item) => (typeof item.eventName === 'string' ? normalizeEventName(item.eventName) : ''))
    .filter((item) => item.length > 0);
}

async function createConversionEvent(accessToken: string, propertyId: string, eventName: string): Promise<void> {
  const response = await fetch(
    `https://analyticsadmin.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/conversionEvents`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        eventName,
      }),
    },
  );

  if (response.ok) {
    return;
  }

  const text = await response.text();
  if (response.status === 409) {
    return;
  }

  throw new Error(`ga4_create_conversion_failed:${response.status}:${truncate(text)}`);
}

function normalizeEventName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function truncate(value: string): string {
  if (value.length <= 200) {
    return value;
  }

  return `${value.slice(0, 200)}...`;
}
