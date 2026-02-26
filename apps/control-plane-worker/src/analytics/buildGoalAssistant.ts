export interface GoalAssistantPayload {
  site_id: string;
  domain: string;
  business_type: string;
  objective: string;
  channels: string[];
  form_types: string[];
  avg_lead_value: number;
  ga4_measurement_id: string;
  gtm_container_id: string;
}

export function buildGoalAssistantPlan(payload: GoalAssistantPayload): Record<string, unknown> {
  const business = payload.business_type.trim() || 'local business';
  const objective = payload.objective.trim() || 'increase qualified leads';
  const primaryGoal = pickPrimaryGoal(payload, business, objective);
  const secondaryGoals = pickSecondaryGoals(payload);
  const channels = uniq(payload.channels.map((value) => value.trim().toLowerCase()).filter(Boolean));
  const formTypes = uniq(payload.form_types.map(normalizeEventName).filter(Boolean));

  const recommendedEvents = uniq([
    normalizeEventName(primaryGoal.event),
    ...secondaryGoals.map((goal) => normalizeEventName(goal.event)),
    ...formTypes,
    'awp_form_submit',
    'cta_click',
  ]);

  const conversionTargets = {
    target_cvr_pct: goalConversionRateTarget(business, channels),
    target_cost_per_lead: payload.avg_lead_value > 0 ? round(payload.avg_lead_value * 0.25, 2) : null,
    target_monthly_leads: goalMonthlyLeadTarget(channels.length),
  };

  const suggestedPluginSettings = {
    analytics_primary_conversion: normalizeEventName(primaryGoal.event),
    analytics_secondary_conversions: secondaryGoals.map((goal) => normalizeEventName(goal.event)),
    analytics_funnel_steps: [
      'landing_view',
      'service_view',
      'cta_click',
      normalizeEventName(primaryGoal.event),
    ],
    analytics_key_pages: recommendKeyPages(payload.domain, business),
  };

  return {
    generated_at: new Date().toISOString(),
    site_id: payload.site_id,
    domain: payload.domain,
    summary: `Goal strategy for ${business}: ${objective}.`,
    stack_status: {
      ga4_measurement_id: payload.ga4_measurement_id || 'missing',
      gtm_container_id: payload.gtm_container_id || 'missing',
    },
    goals: {
      primary: primaryGoal,
      secondary: secondaryGoals,
    },
    tracking_plan: {
      recommended_events: recommendedEvents,
      key_funnel_events: [
        'landing_view',
        'service_view',
        'cta_click',
        normalizeEventName(primaryGoal.event),
      ],
      attribution_dimensions: ['source', 'medium', 'campaign', 'page_path'],
    },
    suggested_plugin_settings: suggestedPluginSettings,
    kpi_targets: conversionTargets,
    execution_steps: [
      'Confirm primary goal event in plugin analytics settings.',
      'Map secondary goals to GTM custom event triggers.',
      'Mark primary and high-intent secondary events as GA4 conversions.',
      'Validate end-to-end events in GTM Preview and GA4 DebugView.',
      'Review weekly channel-to-conversion performance and adjust budget.',
    ],
    quick_wins: [
      'Track phone click and form submit as separate conversion events.',
      'Attach page_path and form_name to every lead event.',
      'Build one remarketing audience from high-intent CTA clicks.',
    ],
  };
}

function pickPrimaryGoal(
  payload: GoalAssistantPayload,
  businessType: string,
  objective: string,
): { name: string; event: string; rationale: string } {
  const text = `${businessType} ${objective}`.toLowerCase();
  if (text.includes('book') || text.includes('appointment')) {
    return {
      name: 'Booked Appointment',
      event: 'book_appointment',
      rationale: 'Appointments map directly to revenue-ready intent.',
    };
  }
  if (text.includes('demo') || text.includes('trial') || text.includes('saas')) {
    return {
      name: 'Demo Request',
      event: 'request_demo',
      rationale: 'Demo requests indicate strong product-fit intent.',
    };
  }
  if (text.includes('purchase') || text.includes('shop') || text.includes('ecom')) {
    return {
      name: 'Purchase',
      event: 'purchase',
      rationale: 'Purchase is the cleanest terminal conversion event.',
    };
  }

  return {
    name: 'Qualified Lead',
    event: 'lead_submit',
    rationale: 'Lead submit is a robust primary goal for most sites.',
  };
}

function pickSecondaryGoals(
  payload: GoalAssistantPayload,
): Array<{ name: string; event: string; priority: 'high' | 'medium' }> {
  const goals: Array<{ name: string; event: string; priority: 'high' | 'medium' }> = [
    { name: 'Form Submit', event: 'awp_form_submit', priority: 'high' },
    { name: 'Phone Click', event: 'phone_call_click', priority: 'medium' },
    { name: 'Primary CTA Click', event: 'cta_click', priority: 'medium' },
  ];

  const formTypes = uniq(payload.form_types.map(normalizeEventName).filter(Boolean));
  for (const formType of formTypes.slice(0, 4)) {
    goals.push({
      name: `Form Action: ${formType}`,
      event: formType,
      priority: 'medium',
    });
  }

  return uniqByEvent(goals).slice(0, 6);
}

function goalConversionRateTarget(businessType: string, channels: string[]): number {
  const text = businessType.toLowerCase();
  if (text.includes('saas') || text.includes('software')) {
    return channels.includes('seo') ? 2.5 : 1.8;
  }
  if (text.includes('ecom') || text.includes('shop')) {
    return 1.8;
  }
  return channels.includes('google_ads') ? 6 : 4;
}

function goalMonthlyLeadTarget(channelCount: number): number {
  if (channelCount >= 3) {
    return 120;
  }
  if (channelCount === 2) {
    return 80;
  }
  return 50;
}

function normalizeEventName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqByEvent(
  goals: Array<{ name: string; event: string; priority: 'high' | 'medium' }>,
): Array<{ name: string; event: string; priority: 'high' | 'medium' }> {
  const seen = new Set<string>();
  const out: Array<{ name: string; event: string; priority: 'high' | 'medium' }> = [];
  for (const goal of goals) {
    const event = normalizeEventName(goal.event);
    if (!event || seen.has(event)) {
      continue;
    }
    seen.add(event);
    out.push({ ...goal, event });
  }

  return out;
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function recommendKeyPages(domain: string, businessType: string): string[] {
  const base = [
    '/',
    '/services',
    '/contact',
  ];
  const text = businessType.toLowerCase();
  if (text.includes('saas') || text.includes('software')) {
    return uniq([...base, '/pricing', '/demo']);
  }
  if (text.includes('ecom') || text.includes('shop')) {
    return uniq([...base, '/products', '/checkout']);
  }
  if (domain.trim() === '') {
    return base;
  }

  return base;
}
