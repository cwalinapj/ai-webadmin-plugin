<?php

namespace WebAdminEdgeAgent\Api\Endpoints;

class SecurityReport
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
