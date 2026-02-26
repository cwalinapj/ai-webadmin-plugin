export interface GtmDeployInput {
  gtmAccountId: string;
  gtmContainerId: string;
  gtmWorkspaceName: string;
  ga4MeasurementId: string;
  conversionEvents: string[];
}

interface GtmEntity {
  triggerId?: string;
  tagId?: string;
  workspaceId?: string;
  name?: string;
}

export async function deployGtm(accessToken: string, input: GtmDeployInput): Promise<Record<string, unknown>> {
  if (!input.gtmAccountId || !input.gtmContainerId || !input.ga4MeasurementId) {
    return {
      status: 'skipped',
      reason: 'missing_gtm_or_ga4_fields',
    };
  }

  const workspace = await ensureWorkspace(
    accessToken,
    input.gtmAccountId,
    input.gtmContainerId,
    input.gtmWorkspaceName,
  );
  const workspaceId = workspace.workspaceId ?? '';
  if (workspaceId === '') {
    throw new Error('gtm_workspace_missing_id');
  }

  const allPagesTriggerId = await ensureAllPagesTrigger(
    accessToken,
    input.gtmAccountId,
    input.gtmContainerId,
    workspaceId,
  );

  await ensureGa4ConfigTag(
    accessToken,
    input.gtmAccountId,
    input.gtmContainerId,
    workspaceId,
    input.ga4MeasurementId,
    allPagesTriggerId,
  );

  const eventDetails: Array<Record<string, string>> = [];
  for (const eventName of input.conversionEvents) {
    const triggerId = await ensureCustomEventTrigger(
      accessToken,
      input.gtmAccountId,
      input.gtmContainerId,
      workspaceId,
      eventName,
    );
    await ensureGa4EventTag(
      accessToken,
      input.gtmAccountId,
      input.gtmContainerId,
      workspaceId,
      input.ga4MeasurementId,
      eventName,
      triggerId,
    );
    eventDetails.push({ event: eventName, trigger_id: triggerId });
  }

  const versionId = await createAndPublishVersion(
    accessToken,
    input.gtmAccountId,
    input.gtmContainerId,
    workspaceId,
  );

  return {
    status: 'ok',
    workspace_id: workspaceId,
    all_pages_trigger_id: allPagesTriggerId,
    event_details: eventDetails,
    published_version_id: versionId,
  };
}

async function ensureWorkspace(
  accessToken: string,
  accountId: string,
  containerId: string,
  workspaceName: string,
): Promise<GtmEntity> {
  const safeName = workspaceName.trim() || 'WebAdmin Auto';
  const list = await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces`,
    'GET',
  );
  const existing = list.workspace?.find((item: GtmEntity) => item.name === safeName);
  if (existing) {
    return existing;
  }

  const created = await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces`,
    'POST',
    {
      name: safeName,
      description: 'Created by WebAdmin Edge Agent for automated conversion deployment',
    },
  );
  return created as GtmEntity;
}

async function ensureAllPagesTrigger(
  accessToken: string,
  accountId: string,
  containerId: string,
  workspaceId: string,
): Promise<string> {
  const triggerName = 'WebAdmin - All Pages';
  const list = await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}/triggers`,
    'GET',
  );
  const existing = list.trigger?.find((item: GtmEntity) => item.name === triggerName && item.triggerId);
  if (existing?.triggerId) {
    return existing.triggerId;
  }

  const created = await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}/triggers`,
    'POST',
    {
      name: triggerName,
      type: 'PAGEVIEW',
    },
  );

  const triggerId = (created as GtmEntity).triggerId;
  if (!triggerId) {
    throw new Error('gtm_all_pages_trigger_create_failed');
  }

  return triggerId;
}

async function ensureCustomEventTrigger(
  accessToken: string,
  accountId: string,
  containerId: string,
  workspaceId: string,
  eventName: string,
): Promise<string> {
  const triggerName = `WebAdmin - Event - ${eventName}`;
  const list = await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}/triggers`,
    'GET',
  );
  const existing = list.trigger?.find((item: GtmEntity) => item.name === triggerName && item.triggerId);
  if (existing?.triggerId) {
    return existing.triggerId;
  }

  const created = await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}/triggers`,
    'POST',
    {
      name: triggerName,
      type: 'CUSTOM_EVENT',
      customEventFilter: [
        {
          type: 'EQUALS',
          parameter: [
            {
              type: 'TEMPLATE',
              key: 'arg0',
              value: '{{_event}}',
            },
            {
              type: 'TEMPLATE',
              key: 'arg1',
              value: eventName,
            },
          ],
        },
      ],
    },
  );

  const triggerId = (created as GtmEntity).triggerId;
  if (!triggerId) {
    throw new Error('gtm_custom_event_trigger_create_failed');
  }

  return triggerId;
}

async function ensureGa4ConfigTag(
  accessToken: string,
  accountId: string,
  containerId: string,
  workspaceId: string,
  measurementId: string,
  allPagesTriggerId: string,
): Promise<void> {
  const tagName = 'WebAdmin - GA4 Config';
  const list = await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}/tags`,
    'GET',
  );
  const existing = list.tag?.find((item: GtmEntity) => item.name === tagName && item.tagId);
  if (existing?.tagId) {
    return;
  }

  await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}/tags`,
    'POST',
    {
      name: tagName,
      type: 'gaawc',
      parameter: [
        {
          type: 'TEMPLATE',
          key: 'measurementId',
          value: measurementId,
        },
      ],
      firingTriggerId: [allPagesTriggerId],
    },
  );
}

async function ensureGa4EventTag(
  accessToken: string,
  accountId: string,
  containerId: string,
  workspaceId: string,
  measurementId: string,
  eventName: string,
  triggerId: string,
): Promise<void> {
  const tagName = `WebAdmin - Conversion - ${eventName}`;
  const list = await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}/tags`,
    'GET',
  );
  const existing = list.tag?.find((item: GtmEntity) => item.name === tagName && item.tagId);
  if (existing?.tagId) {
    return;
  }

  await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}/tags`,
    'POST',
    {
      name: tagName,
      type: 'gaawe',
      parameter: [
        {
          type: 'TEMPLATE',
          key: 'eventName',
          value: eventName,
        },
        {
          type: 'TEMPLATE',
          key: 'measurementId',
          value: measurementId,
        },
      ],
      firingTriggerId: [triggerId],
    },
  );
}

async function createAndPublishVersion(
  accessToken: string,
  accountId: string,
  containerId: string,
  workspaceId: string,
): Promise<string> {
  const version = await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/workspaces/${encodeURIComponent(workspaceId)}:create_version`,
    'POST',
    {
      name: `WebAdmin Auto ${new Date().toISOString()}`,
      notes: 'Created automatically by WebAdmin Edge Agent',
    },
  );

  const versionId =
    (version?.containerVersion?.containerVersionId as string | undefined) ??
    (version?.containerVersionId as string | undefined) ??
    '';
  if (!versionId) {
    throw new Error('gtm_create_version_failed');
  }

  await gtmApi(
    accessToken,
    `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${encodeURIComponent(accountId)}/containers/${encodeURIComponent(containerId)}/versions/${encodeURIComponent(versionId)}:publish`,
    'POST',
  );

  return versionId;
}

async function gtmApi(
  accessToken: string,
  url: string,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<Record<string, any>> {
  const response = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`gtm_api_failed:${response.status}:${truncate(text)}`);
  }

  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    return {};
  }
}

function truncate(value: string): string {
  if (value.length <= 200) {
    return value;
  }

  return `${value.slice(0, 200)}...`;
}
