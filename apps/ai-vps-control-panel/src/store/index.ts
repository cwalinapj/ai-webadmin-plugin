import path from 'node:path';
import { SqliteStore } from './sqliteStore.js';

export function defaultDbPath(): string {
  if (process.env.AI_VPS_DB_PATH && process.env.AI_VPS_DB_PATH.trim() !== '') {
    return process.env.AI_VPS_DB_PATH.trim();
  }
  return path.resolve(process.cwd(), 'data', 'ai-vps-control-panel.sqlite');
}

export function createStore(): SqliteStore {
  return new SqliteStore(defaultDbPath());
}
