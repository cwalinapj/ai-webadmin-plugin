<?php

namespace WebAdminEdgeAgent\Storage;

class TabState
{
    public const OPTION_KEY = 'webadmin_edge_agent_tab_state';

    /**
     * @return array<string, array<string, mixed>>
     */
    public function defaults(): array
    {
        return [
            'uptime' => $this->emptyState(),
            'security' => $this->emptyState(),
            'analytics' => $this->emptyState(),
            'dns-email' => $this->emptyState(),
            'leads' => $this->emptyState(),
        ];
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    public function all(): array
    {
        $stored = get_option(self::OPTION_KEY, []);
        if (!is_array($stored)) {
            $stored = [];
        }

        $defaults = $this->defaults();
        foreach ($defaults as $tab => $defaultState) {
            $candidate = $stored[$tab] ?? [];
            if (!is_array($candidate)) {
                $candidate = [];
            }
            $stored[$tab] = array_merge($defaultState, $candidate);
            if (!is_array($stored[$tab]['findings'])) {
                $stored[$tab]['findings'] = [];
            }
        }

        return $stored;
    }

    /**
     * @return array<string, mixed>
     */
    public function get(string $tab): array
    {
        $all = $this->all();

        return $all[$tab] ?? $this->emptyState();
    }

    public function recordSync(string $tab, string $status, string $message): void
    {
        $all = $this->all();
        $current = $all[$tab] ?? $this->emptyState();
        $current['last_sync_at'] = time();
        $current['last_sync_status'] = sanitize_text_field($status);
        $current['last_sync_message'] = sanitize_text_field($message);
        $all[$tab] = $current;

        update_option(self::OPTION_KEY, $all, false);
    }

    public function addFinding(string $tab, string $severity, string $title, string $detail): void
    {
        $all = $this->all();
        $current = $all[$tab] ?? $this->emptyState();
        $findings = $current['findings'];
        if (!is_array($findings)) {
            $findings = [];
        }

        $findings[] = [
            'ts' => gmdate('c'),
            'severity' => sanitize_text_field($severity),
            'title' => sanitize_text_field($title),
            'detail' => sanitize_text_field($detail),
        ];

        if (count($findings) > 50) {
            $findings = array_slice($findings, -50);
        }

        $current['findings'] = $findings;
        $all[$tab] = $current;

        update_option(self::OPTION_KEY, $all, false);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public function recentFindings(string $tab, int $limit = 10): array
    {
        $tabState = $this->get($tab);
        $findings = $tabState['findings'] ?? [];
        if (!is_array($findings)) {
            return [];
        }

        return array_reverse(array_slice($findings, -1 * max(1, $limit)));
    }

    /**
     * @return array<string, mixed>
     */
    private function emptyState(): array
    {
        return [
            'last_sync_at' => 0,
            'last_sync_status' => 'never',
            'last_sync_message' => '',
            'findings' => [],
        ];
    }
}
