import { describe, expect, it } from 'vitest';
import { buildGoalAssistantPlan } from '../src/analytics/buildGoalAssistant';

describe('buildGoalAssistantPlan', () => {
  it('returns suggested plugin settings for auto-apply', () => {
    const plan = buildGoalAssistantPlan({
      site_id: 'site-1',
      domain: 'example.com',
      business_type: 'Dental clinic',
      objective: 'Increase booked appointments',
      channels: ['google_ads', 'seo'],
      form_types: ['contact_form', 'book_now'],
      avg_lead_value: 300,
      ga4_measurement_id: 'G-ABC1234567',
      gtm_container_id: 'GTM-ABCDE12',
    }) as Record<string, unknown>;

    expect(plan.summary).toBeTypeOf('string');
    const suggested = plan.suggested_plugin_settings as Record<string, unknown>;

    expect(suggested.analytics_primary_conversion).toBe('book_appointment');
    expect(suggested.analytics_secondary_conversions).toEqual(expect.arrayContaining(['awp_form_submit']));
    expect(suggested.analytics_funnel_steps).toEqual(
      expect.arrayContaining(['landing_view', 'cta_click', 'book_appointment']),
    );
    expect(suggested.analytics_key_pages).toEqual(expect.arrayContaining(['/contact']));
  });
});
