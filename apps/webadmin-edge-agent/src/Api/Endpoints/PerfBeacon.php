<?php

namespace WebAdminEdgeAgent\Api\Endpoints;

class PerfBeacon
{
    /**
     * @return array<string, mixed>
     */
    public function payload(): array
    {
        return [
            'enabled' => false,
        ];
    }
}
