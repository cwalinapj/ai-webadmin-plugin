<?php

namespace WebAdminEdgeAgent\Admin\Tabs;

class UptimeTab
{
    /**
     * @param array<string, mixed> $context
     */
    public function render(array $context): void
    {
        $settings = $context['settings'];
        if (!is_array($settings)) {
            return;
        }

        $lastAt = (int)($settings['last_heartbeat_at'] ?? 0);
        $lastStatus = (string)($settings['last_heartbeat_status'] ?? 'never');
        $lastMessage = (string)($settings['last_heartbeat_message'] ?? '');
        $sloLastAt = (int)($settings['performance_slo_last_at'] ?? 0);
        $sloLastStatus = (string)($settings['performance_slo_last_status'] ?? 'never');
        $sloLastMessage = (string)($settings['performance_slo_last_message'] ?? '');
        $sloLastResult = (string)($settings['performance_slo_last_result_json'] ?? '');

        ?>
        <h2>Connect</h2>
        <p>Register this site with the Cloudflare control plane. Secrets are never rendered back in the browser.</p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <?php wp_nonce_field('webadmin_edge_agent_save_settings', 'webadmin_edge_agent_nonce'); ?>
          <input type="hidden" name="action" value="webadmin_edge_agent_save_settings" />
          <table class="form-table" role="presentation">
            <tr>
              <th scope="row"><label for="worker_base_url">API Base URL</label></th>
              <td><input class="regular-text" id="worker_base_url" name="worker_base_url" type="url" required value="<?php echo esc_attr((string)$settings['worker_base_url']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="plugin_id">Plugin ID</label></th>
              <td><input class="regular-text" id="plugin_id" name="plugin_id" type="text" required value="<?php echo esc_attr((string)$settings['plugin_id']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="site_id">Site ID</label></th>
              <td><input class="regular-text" id="site_id" name="site_id" type="text" value="<?php echo esc_attr((string)$settings['site_id']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="domain">Domain</label></th>
              <td><input class="regular-text" id="domain" name="domain" type="text" required value="<?php echo esc_attr((string)$settings['domain']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="plan">Plan</label></th>
              <td><input class="regular-text" id="plan" name="plan" type="text" value="<?php echo esc_attr((string)$settings['plan']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="timezone">Timezone</label></th>
              <td><input class="regular-text" id="timezone" name="timezone" type="text" value="<?php echo esc_attr((string)$settings['timezone']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="shared_secret">Shared Secret</label></th>
              <td>
                <input class="regular-text" id="shared_secret" name="shared_secret" type="password" autocomplete="new-password" />
                <p class="description"><?php echo !empty($context['shared_secret_configured']) ? esc_html('Configured. Enter a new value only to rotate.') : esc_html('Not configured yet.'); ?></p>
              </td>
            </tr>
            <tr>
              <th scope="row"><label for="capability_token_uptime">Uptime Capability Token</label></th>
              <td>
                <input class="regular-text" id="capability_token_uptime" name="capability_token_uptime" type="password" autocomplete="new-password" />
                <p class="description"><?php echo !empty($context['capability_token_uptime_configured']) ? esc_html('Configured. Enter a new value only to rotate.') : esc_html('Not configured yet.'); ?></p>
              </td>
            </tr>
          </table>
          <p><button type="submit" class="button button-primary">Save Connection Settings</button></p>
        </form>

        <h2>Uptime Signal Pipeline</h2>
        <p>Heartbeat and performance beacons feed incidents, jobs, and command responses from the control plane.</p>
        <h3>Heartbeat</h3>
        <p>
          Last heartbeat:
          <?php
          if ($lastAt > 0) {
              echo esc_html(gmdate('Y-m-d H:i:s', $lastAt) . ' UTC');
          } else {
              echo esc_html('never');
          }
          ?>
          (<?php echo esc_html($lastStatus); ?>)
        </p>
        <?php if ($lastMessage !== '') : ?>
          <p><?php echo esc_html($lastMessage); ?></p>
        <?php endif; ?>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <?php wp_nonce_field('webadmin_edge_agent_send_heartbeat', 'webadmin_edge_agent_heartbeat_nonce'); ?>
          <input type="hidden" name="action" value="webadmin_edge_agent_send_heartbeat" />
          <p><button type="submit" class="button">Send Heartbeat Now</button></p>
        </form>

        <h2>Performance SLO Mode</h2>
        <p>Define measurable goals, run benchmark-driven strategy, and keep canary+rollback guardrails active.</p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <?php wp_nonce_field('webadmin_edge_agent_save_slo_settings', 'webadmin_edge_agent_slo_settings_nonce'); ?>
          <input type="hidden" name="action" value="webadmin_edge_agent_save_slo_settings" />
          <table class="form-table" role="presentation">
            <tr>
              <th scope="row"><label for="performance_slo_goal_guest_p95_ttfb_ms">Guest p95 TTFB Goal (ms)</label></th>
              <td><input class="small-text" id="performance_slo_goal_guest_p95_ttfb_ms" name="performance_slo_goal_guest_p95_ttfb_ms" type="number" step="1" min="1" value="<?php echo esc_attr((string)$settings['performance_slo_goal_guest_p95_ttfb_ms']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="performance_slo_goal_error_rate_pct">Error Rate Goal (%)</label></th>
              <td><input class="small-text" id="performance_slo_goal_error_rate_pct" name="performance_slo_goal_error_rate_pct" type="number" step="0.01" min="0" value="<?php echo esc_attr((string)$settings['performance_slo_goal_error_rate_pct']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="performance_slo_goal_cache_hit_pct">Cache Hit Goal (%)</label></th>
              <td><input class="small-text" id="performance_slo_goal_cache_hit_pct" name="performance_slo_goal_cache_hit_pct" type="number" step="0.1" min="1" max="100" value="<?php echo esc_attr((string)$settings['performance_slo_goal_cache_hit_pct']); ?>" /></td>
            </tr>
            <tr>
              <th scope="row"><label for="performance_slo_dry_run">Dry Run</label></th>
              <td>
                <input type="hidden" name="performance_slo_dry_run" value="0" />
                <label><input type="checkbox" id="performance_slo_dry_run" name="performance_slo_dry_run" value="1" <?php checked(!empty($settings['performance_slo_dry_run'])); ?> /> Keep canary/rollback actions in planning mode only</label>
              </td>
            </tr>
          </table>
          <p><button type="submit" class="button">Save SLO Settings</button></p>
        </form>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <?php wp_nonce_field('webadmin_edge_agent_run_slo_evaluation', 'webadmin_edge_agent_slo_run_nonce'); ?>
          <input type="hidden" name="action" value="webadmin_edge_agent_run_slo_evaluation" />
          <p><button type="submit" class="button button-primary">Run SLO Benchmark + Strategy + Canary Plan</button></p>
        </form>

        <p>
          Last SLO evaluation:
          <?php
          if ($sloLastAt > 0) {
              echo esc_html(gmdate('Y-m-d H:i:s', $sloLastAt) . ' UTC');
          } else {
              echo esc_html('never');
          }
          ?>
          (<?php echo esc_html($sloLastStatus); ?>)
        </p>
        <?php if ($sloLastMessage !== '') : ?>
          <p><?php echo esc_html($sloLastMessage); ?></p>
        <?php endif; ?>
        <?php if ($sloLastResult !== '') : ?>
          <details>
            <summary>SLO evaluation details</summary>
            <pre style="max-height:280px; overflow:auto;"><?php echo esc_html($sloLastResult); ?></pre>
          </details>
        <?php endif; ?>
        <?php
    }
}
