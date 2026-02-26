<?php

namespace WebAdminEdgeAgent\Api;

class Signer
{
    public static function sha256Hex(string $body): string
    {
        return hash('sha256', $body);
    }

    public static function canonical(string $timestamp, string $nonce, string $method, string $path, string $body): string
    {
        $normalizedMethod = strtoupper($method);
        $bodyHash = self::sha256Hex($body);

        return implode('.', [$timestamp, $nonce, $normalizedMethod, $path, $bodyHash]);
    }

    public static function sign(string $secret, string $timestamp, string $nonce, string $method, string $path, string $body): string
    {
        $canonical = self::canonical($timestamp, $nonce, $method, $path, $body);

        return hash_hmac('sha256', $canonical, $secret);
    }

    public static function verify(string $secret, string $signature, string $timestamp, string $nonce, string $method, string $path, string $body): bool
    {
        $computed = self::sign($secret, $timestamp, $nonce, $method, $path, $body);

        return hash_equals($computed, $signature);
    }
}
