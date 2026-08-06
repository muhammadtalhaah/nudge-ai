/**
 * AI interaction logging — the brief's "log AI interactions for debugging or analytics".
 *
 * Persisted rather than console-only, because the questions worth asking are aggregate:
 * how often does extraction fail, how often do we fall back to the form, how slow is the
 * provider, what does a conversation cost.
 */

import type { Executor } from '../db/pool.ts';
import type { ExtractionOutcome } from '../ai/extraction.ts';

export interface AiLogInput {
  businessId: string;
  userId: string | null;
  sessionId: string | null;
  messageId: string | null;
  provider: string;
  model: string | null;
  outcome: ExtractionOutcome;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
  requestPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  errorMessage: string | null;
}

export const record = async (executor: Executor, input: AiLogInput): Promise<void> => {
  await executor.query(
    `INSERT INTO ai_interaction_logs
       (business_id, user_id, session_id, message_id, provider, model, outcome,
        prompt_tokens, completion_tokens, latency_ms,
        request_payload, response_payload, error_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      input.businessId,
      input.userId,
      input.sessionId,
      input.messageId,
      input.provider,
      input.model,
      input.outcome,
      input.promptTokens,
      input.completionTokens,
      input.latencyMs,
      input.requestPayload ? JSON.stringify(input.requestPayload) : null,
      input.responsePayload ? JSON.stringify(input.responsePayload) : null,
      input.errorMessage,
    ],
  );
};

/** Aggregate view for debugging: how the assistant has actually been behaving. */
export const summarise = async (
  executor: Executor,
  businessId: string,
): Promise<Array<{ outcome: string; count: number; avgLatencyMs: number | null }>> => {
  const { rows } = await executor.query<{
    outcome: string;
    count: string;
    avg_latency: string | null;
  }>(
    `SELECT outcome, count(*)::text AS count, round(avg(latency_ms))::text AS avg_latency
       FROM ai_interaction_logs
      WHERE business_id = $1
      GROUP BY outcome
      ORDER BY count(*) DESC`,
    [businessId],
  );

  return rows.map((row) => ({
    outcome: row.outcome,
    count: Number(row.count),
    avgLatencyMs: row.avg_latency === null ? null : Number(row.avg_latency),
  }));
};

export default { record, summarise };
