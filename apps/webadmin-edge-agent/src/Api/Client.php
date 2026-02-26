<?php

namespace WebAdminEdgeAgent\Api;

use WebAdminEdgeAgent\Security\Capabilities;
use WebAdminEdgeAgent\Security\Nonce;
use WebAdminEdgeAgent\Storage\Logger;
use WebAdminEdgeAgent\Storage\Options;

class Client
{
    private Options $options;

    private Logger $logger;

    public function __construct(Options $options, Logger $logger)
    {
        $this->options = $options;
        $this->logger = $logger;
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    public function requestJson(string $method, string $path, array $payload, string $capability): array
    {
        $settings = $this->options->getSettings();
        $baseUrl = rtrim((string)$settings['worker_base_url'], '/');
        $pluginId = (string)$settings['plugin_id'];
        $sharedSecret = $this->options->getDecryptedSecret('shared_secret');

        if ($baseUrl === '' || $pluginId === '' || $sharedSecret === '') {
            return [
                'ok' => false,
                'status' => 0,
                'error' => 'missing_connection_settings',
            ];
        }

        $capabilityMap = Capabilities::headerMap();
        $capabilityOptionKey = $capabilityMap[$capability] ?? '';
        $capabilityToken = $capabilityOptionKey !== '' ? $this->options->getDecryptedSecret($capabilityOptionKey) : '';
        if ($capabilityToken === '') {
            return [
                'ok' => false,
                'status' => 0,
                'error' => 'missing_capability_token',
            ];
        }

        $normalizedPath = '/' . ltrim($path, '/');
        $url = $baseUrl . $normalizedPath;
        $normalizedMethod = strtoupper($method);
        $body = wp_json_encode($payload);
        if (!is_string($body)) {
            return [
                'ok' => false,
                'status' => 0,
                'error' => 'json_encode_failed',
            ];
        }

        $timestamp = (string)time();
        $nonce = Nonce::uuidV4();
        $idempotencyKey = Nonce::uuidV4();
        $requestId = Nonce::uuidV4();

        $signature = Signer::sign($sharedSecret, $timestamp, $nonce, $normalizedMethod, $normalizedPath, $body);

        $headers = [
            'Content-Type' => 'application/json',
            'X-Plugin-Id' => $pluginId,
            'X-Plugin-Timestamp' => $timestamp,
            'X-Plugin-Nonce' => $nonce,
            'X-Plugin-Signature' => $signature,
            'X-Capability-Token' => $capabilityToken,
            'Idempotency-Key' => $idempotencyKey,
            'X-Request-Id' => $requestId,
        ];

        $response = wp_remote_request($url, [
            'method' => $normalizedMethod,
            'headers' => $headers,
            'body' => $body,
            'timeout' => 20,
        ]);

        if (is_wp_error($response)) {
            $this->logger->log('error', 'Worker request failed', [
                'path' => $normalizedPath,
                'reason' => $response->get_error_message(),
                'request_id' => $requestId,
            ]);

            return [
                'ok' => false,
                'status' => 0,
                'error' => 'wp_remote_request_failed',
                'request_id' => $requestId,
            ];
        }

        $status = (int)wp_remote_retrieve_response_code($response);
        $rawBody = (string)wp_remote_retrieve_body($response);
        $decoded = json_decode($rawBody, true);

        $this->logger->log($status >= 200 && $status < 300 ? 'info' : 'error', 'Worker request completed', [
            'path' => $normalizedPath,
            'status' => (string)$status,
            'request_id' => $requestId,
        ]);

        return [
            'ok' => $status >= 200 && $status < 300,
            'status' => $status,
            'body' => is_array($decoded) ? $decoded : ['raw' => $rawBody],
            'request_id' => $requestId,
        ];
    }
}
