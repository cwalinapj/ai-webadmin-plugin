<?php

namespace WebAdminEdgeAgent\Admin\Tabs;

class DnsEmailTab
{
    public function render(): void
    {
        ?>
        <h2>Domain, DNS &amp; Email</h2>
        <p>Signals + jobs + commands: desired-state sync and drift checks produce fix plans and approvals.</p>
        <ul>
          <li>Domain renewal and nameserver checks</li>
          <li>DNS desired-state drift detection</li>
          <li>Email auth and routing diagnostics</li>
        </ul>
        <?php
    }
}
