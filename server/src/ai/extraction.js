/**
 * The guardrail between the model and the application.
 *
 * A model returns text. This module turns that text into either a validated extraction or an
 * explicit failure — and nothing else. Every path out of here has been through
 * `aiExtractionSchema`, so the chat service cannot accidentally consume unvalidated model
 * output.
 *
 * The failure cases are the interesting ones, because they are the common ones in practice:
 * malformed JSON, prose wrapped around JSON, a hallucinated intent, a missing field. All of
 * them degrade to the structured form rather than propagating into a booking.
 */

import { aiExtractionSchema } from '../../../shared/schemas.js';

import { env } from '../config/env.js';
import { aiLogger } from '../logger/index.js';
import { createMistralProvider } from './providers/mistral.js';
import { createStubProvider } from './providers/stub.js';
import { ProviderError } from './provider.js';

/** Chosen once at boot from resolved config — see env.aiProvider. */
let activeProvider = null;

/** @returns {import('./provider.js').AiProvider} */
export const getProvider = () => {
  if (!activeProvider) {
    activeProvider = env.aiProvider === 'mistral' ? createMistralProvider() : createStubProvider();
    aiLogger.info(
      { provider: activeProvider.name, model: env.MISTRAL_MODEL },
      'ai provider initialised',
    );
  }
  return activeProvider;
};

/**
 * Test seam: swap in a provider that returns whatever a test needs.
 *
 * @param {import('./provider.js').AiProvider | null} provider
 */
export const setProviderForTesting = (provider) => {
  activeProvider = provider;
};

/**
 * What one extraction turn produced. `outcome` is one of 'success', 'invalid_output',
 * 'provider_error' or 'timeout', and is what the aggregate log is grouped by.
 *
 * @typedef {object} ExtractionTelemetry
 * @property {string} provider
 * @property {string | null} model
 * @property {'success' | 'invalid_output' | 'provider_error' | 'timeout'} outcome
 * @property {number | null} promptTokens
 * @property {number | null} completionTokens
 * @property {number} latencyMs
 * @property {string | null} rawResponse
 * @property {string | null} errorMessage
 */

/**
 * @typedef {object} ExtractionResult
 * @property {boolean} ok
 * @property {import('zod').infer<typeof aiExtractionSchema>} [extraction] Present only when
 *   `ok` is true. Already schema-validated.
 * @property {ExtractionTelemetry} telemetry
 * @property {boolean} degraded
 */

/**
 * Pull a JSON object out of a model response.
 *
 * Even in JSON mode, models occasionally wrap the object in a markdown fence or add a
 * sentence of commentary. Recovering the object is worth doing — it turns a would-be
 * failure into a success — but it is strictly a parse convenience: whatever comes out is
 * still validated against the schema before anyone trusts it.
 */
const extractJsonObject = (raw) => {
  const trimmed = raw.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to recovery.
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      // Fall through.
    }
  }

  // Widest balanced-looking span between the first { and the last }.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // Give up; the caller treats this as invalid_output.
    }
  }

  return null;
};

/**
 * Run one extraction turn.
 *
 * Never throws. A provider outage, a timeout, or unusable output all return `ok: false`, and
 * the chat service responds with the structured form. An assistant that 500s because a
 * third-party API had a bad minute would be a worse product than one that hands you a form.
 *
 * @param {import('./provider.js').CompletionRequest} request
 * @returns {Promise<ExtractionResult>}
 */
export const extract = async (request) => {
  const provider = getProvider();
  const startedAt = performance.now();

  const baseTelemetry = {
    provider: provider.name,
    model: null,
    promptTokens: null,
    completionTokens: null,
    rawResponse: null,
    errorMessage: null,
  };

  try {
    const completion = await provider.complete(request);
    const latencyMs = Math.round(performance.now() - startedAt);

    const telemetry = {
      ...baseTelemetry,
      model: completion.model,
      promptTokens: completion.promptTokens,
      completionTokens: completion.completionTokens,
      latencyMs,
      // Truncated: these rows are kept for debugging, not as a transcript store.
      rawResponse: completion.raw.slice(0, 4000),
      outcome: 'success',
    };

    const candidate = extractJsonObject(completion.raw);
    if (candidate === null) {
      aiLogger.warn({ provider: provider.name }, 'model response contained no JSON object');
      return {
        ok: false,
        degraded: provider.isDeterministic,
        telemetry: {
          ...telemetry,
          outcome: 'invalid_output',
          errorMessage: 'No JSON object in response',
        },
      };
    }

    const parsed = aiExtractionSchema.safeParse(candidate);
    if (!parsed.success) {
      const summary = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');

      aiLogger.warn({ provider: provider.name, issues: summary }, 'model output failed validation');
      return {
        ok: false,
        degraded: provider.isDeterministic,
        telemetry: { ...telemetry, outcome: 'invalid_output', errorMessage: summary.slice(0, 500) },
      };
    }

    return {
      ok: true,
      extraction: parsed.data,
      degraded: provider.isDeterministic,
      telemetry,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
    const isTimeout = error instanceof ProviderError && error.isTimeout;
    const message = error instanceof Error ? error.message : String(error);

    aiLogger.error({ err: error, provider: provider.name, latencyMs }, 'ai provider call failed');

    return {
      ok: false,
      degraded: provider.isDeterministic,
      telemetry: {
        ...baseTelemetry,
        latencyMs,
        outcome: isTimeout ? 'timeout' : 'provider_error',
        errorMessage: message.slice(0, 500),
      },
    };
  }
};
