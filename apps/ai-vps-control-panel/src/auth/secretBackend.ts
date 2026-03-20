import { createHash } from 'node:crypto';

type SecretBackendType = 'local' | 'vault';

export interface SecretBackend {
  type: SecretBackendType;
  hashToken(token: string): Promise<string>;
}

const FALLBACK_PEPPER = 'dev-only-pepper-change-me';

interface VaultConfig {
  addr: string;
  token: string;
  transitPath: string;
  hmacKey: string;
}

class LocalSecretBackend implements SecretBackend {
  readonly type: SecretBackendType = 'local';

  async hashToken(token: string): Promise<string> {
    const pepper = process.env.AI_VPS_TOKEN_PEPPER?.trim() || FALLBACK_PEPPER;
    return createHash('sha256').update(`${pepper}:${token}`).digest('hex');
  }
}

class VaultSecretBackend implements SecretBackend {
  readonly type: SecretBackendType = 'vault';

  constructor(private readonly config: VaultConfig) {}

  async hashToken(token: string): Promise<string> {
    const input = Buffer.from(token, 'utf8').toString('base64');
    const endpoint = `${this.config.addr}/v1/${this.config.transitPath}/hmac/${this.config.hmacKey}/sha2-256`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vault-token': this.config.token,
      },
      body: JSON.stringify({
        input,
      }),
    });

    if (!response.ok) {
      throw new Error(`vault_hmac_failed_${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: {
        hmac?: unknown;
      };
    };
    const hmac = payload?.data?.hmac;
    if (typeof hmac !== 'string' || hmac.trim() === '') {
      throw new Error('vault_hmac_missing');
    }
    return hmac.trim();
  }
}

function selectedBackendType(): SecretBackendType {
  const configured = process.env.AI_VPS_SECRET_BACKEND?.trim().toLowerCase();
  if (configured === 'vault') {
    return 'vault';
  }
  return 'local';
}

function parseVaultConfig(): VaultConfig {
  const addrRaw = process.env.AI_VPS_VAULT_ADDR?.trim() || '';
  const token = process.env.AI_VPS_VAULT_TOKEN?.trim() || '';
  const transitPath = process.env.AI_VPS_VAULT_TRANSIT_PATH?.trim() || 'transit';
  const hmacKey = process.env.AI_VPS_VAULT_HMAC_KEY?.trim() || 'ai-vps-token-hmac';

  if (addrRaw === '' || token === '') {
    throw new Error('vault_config_missing');
  }

  return {
    addr: addrRaw.replace(/\/+$/, ''),
    token,
    transitPath: transitPath.replace(/^\/+|\/+$/g, ''),
    hmacKey,
  };
}

function backendCacheSource(): string {
  return [
    selectedBackendType(),
    process.env.AI_VPS_TOKEN_PEPPER?.trim() || '',
    process.env.AI_VPS_VAULT_ADDR?.trim() || '',
    process.env.AI_VPS_VAULT_TOKEN?.trim() || '',
    process.env.AI_VPS_VAULT_TRANSIT_PATH?.trim() || '',
    process.env.AI_VPS_VAULT_HMAC_KEY?.trim() || '',
  ].join('|');
}

let cachedSource = '';
let cachedBackend: SecretBackend | null = null;

export function getSecretBackend(): SecretBackend {
  const source = backendCacheSource();
  if (cachedBackend && source === cachedSource) {
    return cachedBackend;
  }

  const type = selectedBackendType();
  cachedBackend = type === 'vault' ? new VaultSecretBackend(parseVaultConfig()) : new LocalSecretBackend();
  cachedSource = source;
  return cachedBackend;
}

export function resetSecretBackendForTests(): void {
  cachedSource = '';
  cachedBackend = null;
}
