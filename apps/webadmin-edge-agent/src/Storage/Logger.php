<?php

namespace WebAdminEdgeAgent\Storage;

class Logger
{
    private const MAX_EVENTS = 1000;

    private Options $options;

    public function __construct(Options $options)
    {
        $this->options = $options;
    }

    /**
     * @param array<string, mixed> $context
     */
    public function log(string $level, string $event, array $context = []): void
    {
        $events = $this->allEvents();
        $cleanContext = $this->sanitizeContext($context);
        $requestId = isset($cleanContext['request_id']) ? (string)$cleanContext['request_id'] : '';
        $jobId = isset($cleanContext['job_id']) ? (string)$cleanContext['job_id'] : '';

        $events[] = [
            'ts' => gmdate('c'),
            'level' => sanitize_text_field($level),
            'event' => sanitize_text_field($event),
            'context' => $cleanContext,
            'request_id' => sanitize_text_field($requestId),
            'job_id' => sanitize_text_field($jobId),
        ];

        if (count($events) > self::MAX_EVENTS) {
            $events = array_slice($events, -1 * self::MAX_EVENTS);
        }

        update_option(Options::LOG_KEY, $events, false);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function recent(int $limit = 100, string $level = '', string $search = ''): array
    {
        $events = $this->filterEvents($this->allEvents(), $level, $search);

        return array_reverse(array_slice($events, -1 * max(1, $limit)));
    }

    public function exportJson(string $level = '', string $search = '', int $limit = 500): string
    {
        $events = $this->recent($limit, $level, $search);
        $json = wp_json_encode([
            'generated_at' => gmdate('c'),
            'filters' => [
                'level' => $level,
                'search' => $search,
                'limit' => max(1, $limit),
            ],
            'count' => count($events),
            'events' => $events,
        ], JSON_PRETTY_PRINT);

        return is_string($json) ? $json : '{"ok":false,"error":"json_encode_failed"}';
    }

    public function countSince(string $level, int $seconds): int
    {
        $events = $this->allEvents();

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
     * @return array<int, array<string, mixed>>
     */
    private function allEvents(): array
    {
        $events = get_option(Options::LOG_KEY, []);
        if (!is_array($events)) {
            return [];
        }

        return $events;
    }

    /**
     * @param array<int, array<string, mixed>> $events
     * @return array<int, array<string, mixed>>
     */
    private function filterEvents(array $events, string $level, string $search): array
    {
        $level = strtolower(trim($level));
        $search = strtolower(trim($search));
        if ($level === '' && $search === '') {
            return $events;
        }

        $filtered = [];
        foreach ($events as $event) {
            if (!is_array($event)) {
                continue;
            }

            $eventLevel = strtolower((string)($event['level'] ?? ''));
            if ($level !== '' && $eventLevel !== $level) {
                continue;
            }

            if ($search !== '') {
                $haystackParts = [
                    strtolower((string)($event['event'] ?? '')),
                    strtolower((string)($event['request_id'] ?? '')),
                    strtolower((string)($event['job_id'] ?? '')),
                    strtolower((string)wp_json_encode($event['context'] ?? [])),
                ];
                $haystack = implode(' ', $haystackParts);
                if (strpos($haystack, $search) === false) {
                    continue;
                }
            }

            $filtered[] = $event;
        }

        return $filtered;
    }

    /**
     * @param array<string, mixed> $context
     * @return array<string, string>
     */
    private function sanitizeContext(array $context): array
    {
        $clean = [];
        foreach ($context as $key => $value) {
            if (is_scalar($value)) {
                $clean[sanitize_key((string)$key)] = sanitize_text_field((string)$value);
                continue;
            }

            $encoded = wp_json_encode($value);
            $clean[sanitize_key((string)$key)] = is_string($encoded) ? $encoded : '';
        }

        return $clean;
    }
}
