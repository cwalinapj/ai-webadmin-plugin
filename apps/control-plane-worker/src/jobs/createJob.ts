export interface CreateJobInput {
  siteId: string;
  tab: string;
  type: string;
  status: string;
  riskScore: number;
}

export interface JobRecord extends CreateJobInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export async function createJob(db: D1Database, input: CreateJobInput): Promise<JobRecord> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO jobs (id, site_id, tab, type, status, risk_score, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
    .bind(id, input.siteId, input.tab, input.type, input.status, input.riskScore, now, now)
    .run();

  return {
    id,
    ...input,
    createdAt: now,
    updatedAt: now,
  };
}
