<?php

namespace WebAdminEdgeAgent\Storage;

class Logger
{
    private Options $options;

    public function __construct(Options $options)
    {
        $this->options = $options;
    }

    /**
     * @param array<string, mixed> $context
     */
    public function log(string $level, string $message, array $context = []): void
    {
        $events = get_option(Options::LOG_KEY, []);
        if (!is_array($events)) {
            $events = [];
        }

        $events[] = [
            'ts' => gmdate('c'),
            'level' => sanitize_text_field($level),
            'message' => sanitize_text_field($message),
            'context' => $this->sanitizeContext($context),
        ];

        if (count($events) > 100) {
            $events = array_slice($events, -100);
        }

        update_option(Options::LOG_KEY, $events, false);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function recent(int $limit = 100): array
    {
        $events = get_option(Options::LOG_KEY, []);
        if (!is_array($events)) {
            return [];
        }

        return array_reverse(array_slice($events, -1 * max(1, $limit)));
    }

    public function countSince(string $level, int $seconds): int
    {
        $events = get_option(Options::LOG_KEY, []);
        if (!is_array($events)) {
            return 0;
        }

        $cutoff = time() - max(0, $seconds);
        $count = 0;
        foreach ($events as $event) {
            if (!is_array($event)) {
                continue;
            }
            $eventLevel = (string)($event['level'] ?? '');
            if ($eventLevel !== $level) {
                continue;
            }
            $ts = strtotime((string)($event['ts'] ?? ''));
            if ($ts !== false && $ts >= $cutoff) {
                $count += 1;
            }
        }

        return $count;
    }

    /**
     * @param array<string, mixed> $context
     * @return array<string, string>
     */
    private function sanitizeContext(array $context): array
    {
        $clean = [];
        foreach ($context as $key => $value) {
            $clean[sanitize_key((string)$key)] = is_scalar($value) ? sanitize_text_field((string)$value) : wp_json_encode($value);
        }

        return $clean;
    }
}
