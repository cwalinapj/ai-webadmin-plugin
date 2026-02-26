<?php

namespace WebAdminEdgeAgent\Admin\Tabs;

class SecurityTab
{
    /**
     * @param array<string, mixed> $context
     */
    public function render(array $context = []): void
    {
        $settings = $context['settings'] ?? [];
        if (!is_array($settings)) {
            $settings = [];
        }
        $lastRunAt = (int)($settings['safe_updates_last_at'] ?? 0);
        $lastRunStatus = (string)($settings['safe_updates_last_status'] ?? 'never');
        $lastRunMessage = (string)($settings['safe_updates_last_message'] ?? '');
        $lastRunResult = (string)($settings['safe_updates_last_result_json'] ?? '');

        ?>
        <h2>Security</h2>
        <p>Signals + jobs + commands: posture sync and integrity reports produce findings and remediation jobs.</p>
        <ul>
          <li>Firewall + malware scanning</li>
          <li>Login protection and brute-force blocking</li>
          <li>Live traffic monitoring and anomaly triage</li>
        </ul>

        <h3>Safe Updates With Rollback</h3>
        <p>Stage updates, canary deploy, run health checks, and auto-rollback if SLO worsens.</p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
          <?php wp_nonce_field('webadmin_edge_agent_run_safe_update_workflow', 'webadmin_edge_agent_safe_update_nonce'); ?>
          <input type="hidden" name="action" value="webadmin_edge_agent_run_safe_update_workflow" />
          <table class="form-table" role="presentation">
            <tr>
              <th scope="row">Update Targets</th>
              <td>
                <input type="hidden" name="safe_updates_include_core" value="0" />
                <label><input type="checkbox" name="safe_updates_include_core" value="1" <?php checked(!empty($settings['safe_updates_include_core'])); ?> /> WordPress core</label><br/>
                <input type="hidden" name="safe_updates_include_plugins" value="0" />
                <label><input type="checkbox" name="safe_updates_include_plugins" value="1" <?php checked(!empty($settings['safe_updates_include_plugins'])); ?> /> Plugins</label><br/>
                <input type="hidden" name="safe_updates_include_themes" value="0" />
                <label><input type="checkbox" name="safe_updates_include_themes" value="1" <?php checked(!empty($settings['safe_updates_include_themes'])); ?> /> Themes</label>
              </td>
            </tr>
            <tr>
              <th scope="row"><label for="safe_updates_plugin_allowlist">Plugin Allowlist</label></th>
              <td>
                <textarea class="large-text" rows="4" id="safe_updates_plugin_allowlist" name="safe_updates_plugin_allowlist" placeholder="akismet/akismet.php&#10;woocommerce/woocommerce.php"><?php echo esc_textarea((string)($settings['safe_updates_plugin_allowlist'] ?? '')); ?></textarea>
                <p class="description">Optional; one plugin file per line.</p>
              </td>
            </tr>
            <tr>
              <th scope="row"><label for="safe_updates_theme_allowlist">Theme Allowlist</label></th>
              <td>
                <textarea class="large-text" rows="3" id="safe_updates_theme_allowlist" name="safe_updates_theme_allowlist" placeholder="twentytwentyfive"><?php echo esc_textarea((string)($settings['safe_updates_theme_allowlist'] ?? '')); ?></textarea>
                <p class="description">Optional; one stylesheet slug per line.</p>
              </td>
            </tr>
            <tr>
              <th scope="row"><label for="safe_updates_dry_run">Dry Run</label></th>
              <td>
                <input type="hidden" name="safe_updates_dry_run" value="0" />
                <label><input type="checkbox" id="safe_updates_dry_run" name="safe_updates_dry_run" value="1" <?php checked(!empty($settings['safe_updates_dry_run'])); ?> /> Plan only (no live mutation)</label>
              </td>
            </tr>
          </table>
          <p><button type="submit" class="button button-primary">Run Stage -> Canary -> Health Checks Workflow</button></p>
        </form>

        <p>
          Last safe-update run:
          <?php
          if ($lastRunAt > 0) {
              echo esc_html(gmdate('Y-m-d H:i:s', $lastRunAt) . ' UTC');
          } else {
              echo esc_html('never');
          }
          ?>
          (<?php echo esc_html($lastRunStatus); ?>)
        </p>
        <?php if ($lastRunMessage !== '') : ?>
          <p><?php echo esc_html($lastRunMessage); ?></p>
        <?php endif; ?>
        <?php if ($lastRunResult !== '') : ?>
          <details>
            <summary>Safe update workflow details</summary>
            <pre style="max-height:280px; overflow:auto;"><?php echo esc_html($lastRunResult); ?></pre>
          </details>
        <?php endif; ?>
        <?php
    }
}
