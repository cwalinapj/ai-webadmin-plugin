import type { JobRecord } from '../jobs/createJob';

export async function enqueueJob(queue: Queue, job: JobRecord): Promise<void> {
  await queue.send({
    job_id: job.id,
    site_id: job.siteId,
    tab: job.tab,
    type: job.type,
    status: job.status,
    risk_score: job.riskScore,
    created_at: job.createdAt,
  });
}
