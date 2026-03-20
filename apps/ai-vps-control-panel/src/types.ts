export type RiskLevel = 'low' | 'medium' | 'high';
export type Role = 'viewer' | 'operator' | 'admin';
export type ActionStatus = 'pending' | 'approved' | 'executed' | 'failed' | 'cancelled';
export type TokenType = 'api_key' | 'pat';
export type TokenStatus = 'active' | 'revoked';

export type AgentActionType =
  | 'check_service_status'
  | 'restart_service'
  | 'tail_service_logs'
  | 'run_site_snapshot'
  | 'run_security_scan'
  | 'switch_load_balancer_mode'
  | 'noop';

export interface AgentAction {
  id: string;
  type: AgentActionType;
  description: string;
  risk: RiskLevel;
  requires_confirmation: boolean;
  args: Record<string, string | number | boolean>;
}

export interface ChatRequest {
  site_id: string;
  message: string;
  conversation_id?: string;
}

export interface ChatResponse {
  ok: boolean;
  conversation_id: string;
  assistant_message: string;
  actions: AgentAction[];
}

export interface SiteRecord {
  id: string;
  tenant_id: string;
  domain: string;
  panel_type: string;
  runtime_type: string;
  created_at: string;
  updated_at?: string;
}

export interface ApiPrincipal {
  type: 'env' | 'db' | 'session';
  token_id: string | null;
  token_type: TokenType | null;
  token: string;
  rotated_token?: string;
  role: Role;
  tenant_id: string;
  scopes: string[];
}

export interface ExecuteActionRequest {
  site_id: string;
  action: AgentAction;
  dry_run?: boolean;
  confirmed?: boolean;
}

export interface ExecuteActionResult {
  ok: boolean;
  dry_run: boolean;
  blocked_reason?: string;
  command?: {
    bin: string;
    args: string[];
  };
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  worker_sync?: {
    ok: boolean;
    details?: unknown;
    error?: string;
  };
}

export interface ConversationRecord {
  id: string;
  site_id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  last_message: string;
}

export interface ChatMessageRecord {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface QueuedActionRecord {
  id: string;
  conversation_id: string;
  site_id: string;
  tenant_id: string;
  type: AgentActionType;
  description: string;
  risk: RiskLevel;
  requires_confirmation: boolean;
  args: Record<string, string | number | boolean>;
  status: ActionStatus;
  created_at: string;
  updated_at: string;
  approved_by: string | null;
  approved_at: string | null;
  executed_by: string | null;
  executed_at: string | null;
  execute_result: Record<string, unknown> | null;
}

export interface AuditLogRecord {
  id: string;
  tenant_id: string;
  site_id: string | null;
  actor: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AuthTokenRecord {
  id: string;
  tenant_id: string;
  token_type: TokenType;
  label: string;
  token_hash: string;
  token_prefix: string;
  role: Role;
  scopes: string[];
  status: TokenStatus;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  rotate_after: string | null;
  auto_rotate: boolean;
  rotated_from: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
}

export interface PolicyTemplateRecord {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  category: string;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SitePolicyBindingRecord {
  id: string;
  tenant_id: string;
  site_id: string;
  template_id: string;
  template_name: string;
  status: string;
  applied_by: string;
  applied_at: string;
  notes: string | null;
}

export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';

export interface BillingSubscriptionRecord {
  site_id: string;
  tenant_id: string;
  plugin_id: string;
  plan_code: string;
  status: BillingStatus;
  sandbox_enabled: boolean;
  current_period_end: string | null;
  grace_period_end: string | null;
  updated_by: string;
  updated_at: string;
}

export interface ConsoleSessionRecord {
  id: string;
  email: string;
  role: Role;
  tenant_id: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface LeadCaptureRecord {
  id: string;
  name: string;
  email: string;
  company: string | null;
  source: string;
  product_slug: string | null;
  plan_code: string | null;
  message: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface StripeCheckoutOrderRecord {
  id: string;
  tenant_id: string;
  site_id: string | null;
  lead_id: string | null;
  product_slug: string | null;
  plan_code: string;
  stripe_checkout_session_id: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
  checkout_url: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface StripeWebhookEventRecord {
  id: string;
  stripe_event_id: string;
  event_type: string;
  livemode: boolean;
  status: 'processed' | 'failed';
  tenant_id: string | null;
  site_id: string | null;
  payload: Record<string, unknown>;
  error_message: string | null;
  processed_at: string;
}
