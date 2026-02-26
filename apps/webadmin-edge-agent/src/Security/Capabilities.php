<?php

namespace WebAdminEdgeAgent\Security;

class Capabilities
{
    public const UPTIME_WRITE = 'uptime.write';
    public const SECURITY_WRITE = 'security.write';
    public const ANALYTICS_WRITE = 'analytics.write';
    public const DNS_EMAIL_WRITE = 'dns-email.write';
    public const LEADS_WRITE = 'leads.write';

    /**
     * @return array<string, string>
     */
    public static function headerMap(): array
    {
        return [
            self::UPTIME_WRITE => 'capability_token_uptime',
            self::ANALYTICS_WRITE => 'capability_token_analytics',
        ];
    }
}
