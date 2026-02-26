<?php

namespace WebAdminEdgeAgent\Admin\Tabs;

class SecurityTab
{
    public function render(): void
    {
        ?>
        <h2>Security</h2>
        <p>Signals + jobs + commands: posture sync and integrity reports produce findings and remediation jobs.</p>
        <ul>
          <li>Firewall + malware scanning</li>
          <li>Login protection and brute-force blocking</li>
          <li>Live traffic monitoring and anomaly triage</li>
        </ul>
        <?php
    }
}
