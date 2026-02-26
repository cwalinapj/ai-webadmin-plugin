<?php

namespace WebAdminEdgeAgent\Admin\Tabs;

class LeadsTab
{
    public function render(): void
    {
        ?>
        <h2>Forms, Leads &amp; Integrations</h2>
        <p>Signals + jobs + commands: form schema sync and synthetic end-to-end checks drive anomaly triage.</p>
        <ul>
          <li>Form/booking schema profile sync</li>
          <li>CRM and automation integration health checks</li>
          <li>Synthetic lead-flow tests and triage</li>
        </ul>
        <?php
    }
}
