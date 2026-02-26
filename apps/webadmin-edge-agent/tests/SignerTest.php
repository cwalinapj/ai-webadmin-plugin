<?php

use PHPUnit\Framework\TestCase;
use WebAdminEdgeAgent\Api\Signer;

class SignerTest extends TestCase
{
    public function testCanonicalStringMatchesContract(): void
    {
        $timestamp = '1739982000';
        $nonce = '9f6a8c3e-6f7c-4d9a-bb62-e1d65e6732f3';
        $method = 'POST';
        $path = '/plugin/wp/watchdog/heartbeat';
        $body = '{"site_id":"site_1","wp_version":"6.7.2"}';

        $expected = implode('.', [
            $timestamp,
            $nonce,
            $method,
            $path,
            hash('sha256', $body),
        ]);

        $this->assertSame($expected, Signer::canonical($timestamp, $nonce, $method, $path, $body));
    }

    public function testSignAndVerify(): void
    {
        $secret = 'super-secret-value';
        $timestamp = '1739982000';
        $nonce = '9f6a8c3e-6f7c-4d9a-bb62-e1d65e6732f3';
        $method = 'POST';
        $path = '/plugin/wp/watchdog/heartbeat';
        $body = '{"hello":"world"}';

        $signature = Signer::sign($secret, $timestamp, $nonce, $method, $path, $body);

        $this->assertTrue(Signer::verify($secret, $signature, $timestamp, $nonce, $method, $path, $body));
        $this->assertFalse(Signer::verify($secret, $signature, $timestamp, $nonce, $method, $path, '{"hello":"tampered"}'));
    }
}
