<?php

namespace WebAdminEdgeAgent\Admin\Tabs;

class AnalyticsTab
{
    /**
     * @param array<string, mixed> $context
     */
    public function render(array $context): void
    {
        $settings = $context['settings'] ?? [];
        if (!is_array($settings)) {
            return;
        }

        $googleConnected = !empty($context['google_connected']);
        $googleEmail = (string)($context['google_account_email'] ?? '');
        $googleLastStatus = (string)($context['google_last_status'] ?? 'never');
        $googleLastMessage = (string)($context['google_last_message'] ?? '');
        $googleDeployStatus = (string)($context['google_last_deploy_status'] ?? 'never');
        $googleDeployMessage = (string)($context['google_last_deploy_message'] ?? '');
        $googleDeployJson = (string)($context['google_last_deploy_json'] ?? '');
        ?>
        <h2>Analytics &amp; Reporting</h2>
        <p>Connect GA4 + GTM once, then deploy event pathways and conversions in one click.</p>

        <h3>Google Connection</h3>
        <p>
          Status: <?php echo esc_html($googleConnected ? 'connected' : 'not connected'); ?>
          (<?php echo esc_html($googleLastStatus); ?>)
          <?php if ($googleEmail !== '') : ?>
            - <?php echo esc_html($googleEmail); ?>
          <?php endif; ?>
        </p>
        <?php if ($googleLastMessage !== '') : ?>
          <p><?php echo esc_html($googleLastMessage); ?></p>
        <?php endif; ?>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline-block; margin-right:8px;">
          <?php wp_nonce_field('webadmin_edge_agent_start_google_connect', 'webadmin_edge_agent_google_connect_nonce'); ?>
          <input type="hidden" name="action" value="webadmin_edge_agent_start_google_connect" />
          <button type="submit" class="button button-primary">Connect Google Account</button>
        </form>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline-block;">
          <?php wp_nonce_field('webadmin_edge_agent_refresh_google_status', 'webadmin_edge_agent_google_status_nonce'); ?>
          <input type="hidden" name="action" value="webadmin_edge_agent_refresh_google_status" />
          <button type="submit" class="button">Refresh Google Status</button>
        </form>

        <h3>Google Setup</h3>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <?php wp_nonce_field('webadmin_edge_agent_save_analytics_settings', 'webadmin_edge_agent_analytics_nonce'); ?>
          <input type="hidden" name="action" value="webadmin_edge_agent_save_analytics_settings" />
          <table class="form-table" role="presentation">
            <tr>
              <th scope="row"><label for="ga4_measurement_id">GA4 Measurement ID</label></th>
              <td><input class="regular-text" id="ga4_measurement_id" name="ga4_measurement_id" type="text" placeholder="G-XXXXXXXXXX" value="<?php echo esc_attr((string)$settings['ga4_measurement_id']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="ga4_property_id">GA4 Property ID</label></th>
              <td><input class="regular-text" id="ga4_property_id" name="ga4_property_id" type="text" placeholder="123456789" value="<?php echo esc_attr((string)$settings['ga4_property_id']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="gtm_account_id">GTM Account ID</label></th>
              <td><input class="regular-text" id="gtm_account_id" name="gtm_account_id" type="text" placeholder="123456" value="<?php echo esc_attr((string)$settings['gtm_account_id']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="gtm_container_id">GTM Container ID</label></th>
              <td><input class="regular-text" id="gtm_container_id" name="gtm_container_id" type="text" placeholder="GTM-XXXXXXX" value="<?php echo esc_attr((string)$settings['gtm_container_id']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="gtm_workspace_name">GTM Workspace Name</label></th>
              <td><input class="regular-text" id="gtm_workspace_name" name="gtm_workspace_name" type="text" placeholder="WebAdmin Auto" value="<?php echo esc_attr((string)$settings['gtm_workspace_name']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="gsc_property_url">Search Console Property URL</label></th>
              <td><input class="regular-text" id="gsc_property_url" name="gsc_property_url" type="url" placeholder="https://example.com/" value="<?php echo esc_attr((string)$settings['gsc_property_url']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="capability_token_analytics">Analytics Capability Token</label></th>
              <td>
                <input class="regular-text" id="capability_token_analytics" name="capability_token_analytics" type="password" autocomplete="new-password" />
                <p class="description"><?php echo !empty($context['capability_token_analytics_configured']) ? esc_html('Configured. Enter a new value only to rotate.') : esc_html('Not configured yet.'); ?></p>
              </td>
            </tr>
            <tr>
              <th scope="row"><label for="analytics_primary_conversion">Primary Conversion Event</label></th>
              <td><input class="regular-text" id="analytics_primary_conversion" name="analytics_primary_conversion" type="text" placeholder="lead_submit" value="<?php echo esc_attr((string)$settings['analytics_primary_conversion']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="analytics_secondary_conversions">Secondary Conversion Events</label></th>
              <td>
                <textarea class="large-text" rows="4" id="analytics_secondary_conversions" name="analytics_secondary_conversions" placeholder="awp_form_submit&#10;phone_call_click&#10;book_now_click"><?php echo esc_textarea((string)$settings['analytics_secondary_conversions']); ?></textarea>
                <p class="description">One per line.</p>
              </td>
            </tr>
            <tr>
              <th scope="row"><label for="analytics_funnel_steps">Funnel Steps</label></th>
              <td>
                <textarea class="large-text" rows="4" id="analytics_funnel_steps" name="analytics_funnel_steps" placeholder="landing_view&#10;service_page_view&#10;cta_click&#10;lead_submit"><?php echo esc_textarea((string)$settings['analytics_funnel_steps']); ?></textarea>
                <p class="description">Optional helper list for planning and reporting.</p>
              </td>
            </tr>
            <tr>
              <th scope="row"><label for="analytics_key_pages">Key Pages</label></th>
              <td>
                <textarea class="large-text" rows="4" id="analytics_key_pages" name="analytics_key_pages" placeholder="/&#10;/services&#10;/pricing&#10;/contact"><?php echo esc_textarea((string)$settings['analytics_key_pages']); ?></textarea>
                <p class="description">Optional helper list for reporting.</p>
              </td>
            </tr>
            <tr>
              <th scope="row">Automatic deployment helpers</th>
              <td>
                <input type="hidden" name="enable_gtm_snippet" value="0" />
                <label><input type="checkbox" name="enable_gtm_snippet" value="1" <?php checked(!empty($settings['enable_gtm_snippet'])); ?> /> Inject GTM snippet automatically</label><br/>
                <input type="hidden" name="enable_lead_event_push" value="0" />
                <label><input type="checkbox" name="enable_lead_event_push" value="1" <?php checked(!empty($settings['enable_lead_event_push'])); ?> /> Push form conversion events to dataLayer</label>
              </td>
            </tr>
          </table>
          <p><button type="submit" class="button button-primary">Save Analytics Settings</button></p>
        </form>

        <h3>One-Click Deploy</h3>
        <p>Deploy GTM triggers/tags and GA4 conversion events directly via Google APIs.</p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <?php wp_nonce_field('webadmin_edge_agent_deploy_google_analytics', 'webadmin_edge_agent_google_deploy_nonce'); ?>
          <input type="hidden" name="action" value="webadmin_edge_agent_deploy_google_analytics" />
          <button type="submit" class="button button-primary">Deploy GTM + GA4 Conversions</button>
        </form>
        <p>
          Last deploy status: <?php echo esc_html($googleDeployStatus); ?>
        </p>
        <?php if ($googleDeployMessage !== '') : ?>
          <p><?php echo esc_html($googleDeployMessage); ?></p>
        <?php endif; ?>
        <?php if ($googleDeployJson !== '') : ?>
          <details>
            <summary>Deployment details</summary>
            <pre style="max-height:280px; overflow:auto;"><?php echo esc_html($googleDeployJson); ?></pre>
          </details>
        <?php endif; ?>

        <h3>What this automates</h3>
        <ul>
          <li>GTM snippet deployment without theme edits</li>
          <li>Conversion events pushed to dataLayer on form submits</li>
          <li>GA4 conversion creation from your pathway events</li>
        </ul>
        <?php
    }
}
