<?php

namespace WebAdminEdgeAgent;

use WebAdminEdgeAgent\Admin\Menu;
use WebAdminEdgeAgent\Api\Client;
use WebAdminEdgeAgent\Api\Endpoints\AnalyticsGoogle;
use WebAdminEdgeAgent\Api\Endpoints\Heartbeat;
use WebAdminEdgeAgent\Command\Dispatcher;
use WebAdminEdgeAgent\Storage\JobStore;
use WebAdminEdgeAgent\Storage\Logger;
use WebAdminEdgeAgent\Storage\Options;
use WebAdminEdgeAgent\Storage\TabState;

class Plugin
{
    public const CRON_HOOK = 'webadmin_edge_agent_cron_heartbeat';

    public const CRON_SCHEDULE = 'webadmin_edge_agent_every_5_minutes';

    private static ?self $instance = null;

    private Options $options;

    private Logger $logger;

    private Client $client;

    private Heartbeat $heartbeatEndpoint;

    private AnalyticsGoogle $analyticsGoogleEndpoint;

    private Menu $menu;

    private TabState $tabState;

    private JobStore $jobStore;

    private Dispatcher $dispatcher;

    public static function boot(): void
    {
        if (self::$instance instanceof self) {
            return;
        }

        self::$instance = new self();
        self::$instance->registerHooks();
    }

    private function __construct()
    {
        $this->options = new Options();
        $this->logger = new Logger($this->options);
        $this->tabState = new TabState();
        $this->jobStore = new JobStore();
        $this->dispatcher = new Dispatcher($this->logger, $this->jobStore);
        $this->client = new Client($this->options, $this->logger);
        $this->heartbeatEndpoint = new Heartbeat(
            $this->options,
            $this->logger,
            $this->client,
            $this->dispatcher,
            $this->tabState,
            $this->jobStore
        );
        $this->analyticsGoogleEndpoint = new AnalyticsGoogle(
            $this->options,
            $this->logger,
            $this->client,
            $this->tabState,
            $this->jobStore
        );
        $this->menu = new Menu(
            $this->options,
            $this->logger,
            $this->heartbeatEndpoint,
            $this->analyticsGoogleEndpoint,
            $this->tabState,
            $this->jobStore
        );
    }

    private function registerHooks(): void
    {
        $this->menu->register();

        add_filter('cron_schedules', [$this, 'registerCronSchedule']);
        add_action('init', [$this, 'ensureCronScheduled']);
        add_action(self::CRON_HOOK, [$this, 'runScheduledHeartbeat']);
        add_action('admin_enqueue_scripts', [$this, 'enqueueAssets']);
        add_action('wp_head', [$this, 'renderGtmHeadSnippet'], 1);
        add_action('wp_body_open', [$this, 'renderGtmBodyNoScript']);
        add_action('wp_footer', [$this, 'renderConversionEventBridge'], 100);
    }

    /**
     * @param array<string, array<string, mixed>> $schedules
     * @return array<string, array<string, mixed>>
     */
    public function registerCronSchedule(array $schedules): array
    {
        return self::registerCronScheduleStatic($schedules);
    }

    public function ensureCronScheduled(): void
    {
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + 300, self::CRON_SCHEDULE, self::CRON_HOOK);
        }
    }

    public function runScheduledHeartbeat(): void
    {
        $this->heartbeatEndpoint->send('cron');
    }

    public static function activate(): void
    {
        add_filter('cron_schedules', [self::class, 'registerCronScheduleStatic']);
        if (!wp_next_scheduled(self::CRON_HOOK)) {
            wp_schedule_event(time() + 300, self::CRON_SCHEDULE, self::CRON_HOOK);
        }
        remove_filter('cron_schedules', [self::class, 'registerCronScheduleStatic']);
    }

    public static function deactivate(): void
    {
        while ($timestamp = wp_next_scheduled(self::CRON_HOOK)) {
            wp_unschedule_event($timestamp, self::CRON_HOOK);
        }
    }

    /**
     * @param array<string, array<string, mixed>> $schedules
     * @return array<string, array<string, mixed>>
     */
    public static function registerCronScheduleStatic(array $schedules): array
    {
        $schedules[self::CRON_SCHEDULE] = [
            'interval' => 300,
            'display' => 'Every 5 Minutes (WebAdmin Edge Agent)',
        ];

        return $schedules;
    }

    public function enqueueAssets(string $hook): void
    {
        if ($hook !== 'toplevel_page_webadmin-edge-agent') {
            return;
        }

        wp_enqueue_style(
            'webadmin-edge-agent-admin',
            plugin_dir_url(WEBADMIN_EDGE_AGENT_FILE) . 'assets/admin.css',
            [],
            WEBADMIN_EDGE_AGENT_VERSION
        );

        wp_enqueue_script(
            'webadmin-edge-agent-admin',
            plugin_dir_url(WEBADMIN_EDGE_AGENT_FILE) . 'assets/admin.js',
            [],
            WEBADMIN_EDGE_AGENT_VERSION,
            true
        );
    }

    public function renderGtmHeadSnippet(): void
    {
        if (!$this->shouldRenderGtm()) {
            return;
        }

        $containerId = $this->gtmContainerId();
        if ($containerId === '') {
            return;
        }

        echo "<!-- WebAdmin GTM -->\n";
        echo "<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':";
        echo "new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],";
        echo "j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=";
        echo "'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);";
        echo "})(window,document,'script','dataLayer','" . esc_js($containerId) . "');</script>\n";
    }

    public function renderGtmBodyNoScript(): void
    {
        if (!$this->shouldRenderGtm()) {
            return;
        }

        $containerId = $this->gtmContainerId();
        if ($containerId === '') {
            return;
        }

        echo '<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=' . esc_attr($containerId) . '"';
        echo ' height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>' . "\n";
    }

    public function renderConversionEventBridge(): void
    {
        if (is_admin()) {
            return;
        }

        $settings = $this->options->getSettings();
        if (empty($settings['enable_lead_event_push'])) {
            return;
        }

        echo "<script id=\"webadmin-conversion-bridge\">(function(){";
        echo "window.dataLayer=window.dataLayer||[];";
        echo "window.WebAdminEdge=window.WebAdminEdge||{};";
        echo "window.WebAdminEdge.trackConversion=function(name,params){";
        echo "if(!name){return;}var payload={event:name};";
        echo "if(params&&typeof params==='object'){for(var k in params){if(Object.prototype.hasOwnProperty.call(params,k)){payload[k]=params[k];}}}";
        echo "window.dataLayer.push(payload);};";
        echo "function formName(form){return form.getAttribute('name')||form.getAttribute('id')||'form';}";
        echo "document.addEventListener('submit',function(ev){var form=ev.target;";
        echo "if(!form||form.tagName!=='FORM'){return;}";
        echo "window.WebAdminEdge.trackConversion('awp_form_submit',{form_name:formName(form),page_path:window.location.pathname});";
        echo "},true);";
        echo "document.addEventListener('wpcf7mailsent',function(){";
        echo "window.WebAdminEdge.trackConversion('awp_contact_form_success',{form_name:'contact_form_7',page_path:window.location.pathname});";
        echo "});";
        echo "})();</script>\n";
    }

    private function shouldRenderGtm(): bool
    {
        if (is_admin()) {
            return false;
        }

        $settings = $this->options->getSettings();
        if (empty($settings['enable_gtm_snippet'])) {
            return false;
        }

        return $this->gtmContainerId() !== '';
    }

    private function gtmContainerId(): string
    {
        $settings = $this->options->getSettings();
        $containerId = strtoupper(trim((string)($settings['gtm_container_id'] ?? '')));
        if (!preg_match('/^GTM-[A-Z0-9]+$/', $containerId)) {
            return '';
        }

        return $containerId;
    }
}
