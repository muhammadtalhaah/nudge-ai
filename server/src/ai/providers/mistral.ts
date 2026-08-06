/**
 * Mistral provider — plain `fetch` against the REST API, no SDK.
 *
 * Skipping the SDK is deliberate: the surface we need is one POST, and an SDK would add a
 * dependency whose major-version churn could break the build for no benefit. Node 20+ has
 * global fetch and AbortSignal.timeout.
 *
 * Wire format per Mistral's docs (OpenAI-compatible):
 *   POST https://api.mistral.ai/v1/chat/completions
 *   Authorization: Bearer <key>
 *   { model, messages: [{role, content}], response_format: { type: 'json_object' } }
 *
 * Response shape is validated with Zod before use — if Mistral changes it, this raises a
 * ProviderError and the turn degrades to the structured form rather than crashing.
 *
 * When the caller wants incremental prose, the same request is sent with `stream: true` and
 * the reply is read off an SSE body. Both paths converge on the same `CompletionResult`, so
 * nothing downstream can tell which one ran — streaming changes when text is available, never
 * what the turn is allowed to do.
 */

import { z } from 'zod';

import { env } from '../../config/env.ts';
import { aiLogger } from '../../logger/index.ts';
import {
  ProviderError,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
  type ReplyDeltaHandler,
} from '../provider.ts';
import { createReplyStreamScanner } from '../replyStream.ts';

const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

/**
 * Only the fields we actually consume. Anything else in the payload is ignored, so additive
 * changes upstream cannot break us.
 */
const responseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
        finish_reason: z.string().optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
});

/**
 * Streamed chunks are validated leniently on purpose.
 *
 * A partial response is not the final one, and rejecting the whole turn because a keep-alive
 * frame lacked a field the finished object will have would trade a working reply for a
 * pedantic failure. Anything unrecognised is skipped; the accumulated text is validated in
 * full by the caller either way.
 */
const streamChunkSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(z.object({ delta: z.object({ content: z.string().nullish() }).optional() }))
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .nullish(),
});

/** 429 and 5xx are worth one retry; a 400 or 401 will fail identically every time. */
const isRetryable = (status: number): boolean => status === 429 || status >= 500;

const callOnce = async (request: CompletionRequest, stream: boolean): Promise<Response> => {
  const messages = [
    { role: 'system', content: request.systemPrompt },
    ...request.history,
    { role: 'user', content: request.userMessage },
  ];

  return fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.MISTRAL_MODEL,
      messages,
      // JSON mode. The system prompt also spells out the shape and the word JSON, which
      // Mistral's docs recommend alongside this flag.
      response_format: { type: 'json_object' },
      // Extraction should be reproducible, not creative.
      temperature: 0.1,
      max_tokens: 800,
      stream,
    }),
    signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
  });
};

/**
 * Consume an SSE body, forwarding prose as it appears.
 *
 * Two independent framings are being unpicked here and it is worth keeping them apart:
 * the SSE framing (`data:` lines terminated by a blank line) gives us JSON chunks, and the
 * scanner turns the concatenation of those chunks' content into readable prose. Neither is
 * allowed to assume the other's boundaries — network reads split wherever they like, so the
 * line buffer holds a partial line and the scanner holds a partial escape.
 */
const consumeStream = async (
  response: Response,
  onReplyDelta: ReplyDeltaHandler,
): Promise<CompletionResult> => {
  if (!response.body) throw new ProviderError('Mistral returned a streaming body we cannot read');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const scanner = createReplyStreamScanner('reply');

  let raw = '';
  let pending = '';
  let model: string | null = null;
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;

  const handleLine = (line: string): void => {
    if (!line.startsWith('data:')) return;

    const payload = line.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // A frame we cannot read is a frame we skip; the full text is validated later.
      return;
    }

    const chunk = streamChunkSchema.safeParse(parsed);
    if (!chunk.success) return;

    model ??= chunk.data.model ?? null;

    if (chunk.data.usage) {
      promptTokens = chunk.data.usage.prompt_tokens ?? promptTokens;
      completionTokens = chunk.data.usage.completion_tokens ?? completionTokens;
    }

    const content = chunk.data.choices?.[0]?.delta?.content;
    if (!content) return;

    raw += content;

    // The callback is the caller's business, and a listener that throws must not abort a
    // model call that is otherwise fine.
    const prose = scanner.push(content);
    if (prose) {
      try {
        onReplyDelta(prose);
      } catch (error) {
        aiLogger.warn({ err: error }, 'reply delta listener threw; continuing the stream');
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      pending += decoder.decode(value, { stream: true });

      let breakAt = pending.indexOf('\n');
      while (breakAt >= 0) {
        handleLine(pending.slice(0, breakAt).trim());
        pending = pending.slice(breakAt + 1);
        breakAt = pending.indexOf('\n');
      }
    }

    // A body that ended without a trailing newline still has one line left in it.
    if (pending.trim()) handleLine(pending.trim());
  } catch (error) {
    const isTimeout = error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name);
    throw new ProviderError(
      isTimeout ? `Mistral timed out after ${env.AI_TIMEOUT_MS}ms` : 'Mistral stream ended early',
      { isTimeout, cause: error },
    );
  } finally {
    reader.releaseLock();
  }

  if (!raw.trim()) throw new ProviderError('Mistral returned an empty completion');

  return {
    raw,
    model: model ?? env.MISTRAL_MODEL,
    promptTokens,
    completionTokens,
  };
};

export const createMistralProvider = (): AiProvider => ({
  name: 'mistral',
  isDeterministic: false,
  supportsStreaming: true,

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const streaming = typeof request.onReplyDelta === 'function';
    let response: Response;

    try {
      response = await callOnce(request, streaming);

      // Retrying is still safe with streaming on: the status is known before the body is
      // read, so a retried request cannot follow prose the user has already seen.
      if (isRetryable(response.status)) {
        aiLogger.warn(
          { status: response.status },
          'mistral returned a retryable status, retrying once',
        );
        response = await callOnce(request, streaming);
      }
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'TimeoutError';
      throw new ProviderError(
        isTimeout ? `Mistral timed out after ${env.AI_TIMEOUT_MS}ms` : 'Could not reach Mistral',
        { isTimeout, cause: error },
      );
    }

    if (!response.ok) {
      // Read the body for diagnostics, but never surface it to the user — it may echo the
      // prompt back, and an upstream error message is not ours to show.
      const body = await response.text().catch(() => '');
      aiLogger.error(
        { status: response.status, body: body.slice(0, 500) },
        'mistral request failed',
      );
      throw new ProviderError(`Mistral responded ${response.status}`);
    }

    if (streaming) return consumeStream(response, request.onReplyDelta!);

    const payload = await response.json().catch((error: unknown) => {
      throw new ProviderError('Mistral returned a body that was not JSON', { cause: error });
    });

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      aiLogger.error({ issues: parsed.error.issues }, 'unexpected mistral response shape');
      throw new ProviderError('Mistral returned an unexpected response shape');
    }

    const content = parsed.data.choices[0]!.message.content;
    if (!content.trim()) {
      throw new ProviderError('Mistral returned an empty completion');
    }

    return {
      raw: content,
      model: parsed.data.model ?? env.MISTRAL_MODEL,
      promptTokens: parsed.data.usage?.prompt_tokens ?? null,
      completionTokens: parsed.data.usage?.completion_tokens ?? null,
    };
  },
});
