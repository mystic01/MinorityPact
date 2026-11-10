import type { AgentController, DecisionInput, DecisionResult } from '../contracts/decision.ts';
import { parseDecision } from '../contracts/schema.ts';
import { object } from '../contracts/validation.ts';
import type { SessionConfig } from '../domain/config.ts';
import { SYSTEM_PROMPT, decisionSchemaFor, contractPrompt } from './prompt.ts';
import { providerInput } from './provider-input.ts';
export type AuditSink = (snapshotId: string, record: Record<string, unknown>) => void;
export class ProviderDecisionError extends Error {
  readonly code: string; readonly retryable: boolean;
  constructor(code: string, retryable: boolean) { super('OpenRouter decision failed; inspect private audit'); this.code = code; this.retryable = retryable; }
}
export class OpenRouterController implements AgentController {
  private llm: SessionConfig['llm']; private key: string; private fetcher: typeof fetch; private audit: AuditSink;
  constructor(llm: SessionConfig['llm'], key: string, audit: AuditSink, fetcher: typeof fetch = fetch) {
    if (!key.trim() || !llm.model.trim()) throw new Error('OpenRouter key and model required');
    this.llm = structuredClone(llm); this.key = key; this.audit = audit; this.fetcher = fetcher;
  }
  async decide(input: Readonly<DecisionInput>, signal: AbortSignal, validationFeedback?: string): Promise<DecisionResult> {
    const body = { ...this.llm.parameters, model: this.llm.model, stream: false,
      provider: { require_parameters: true },
      messages: [{ role: 'system', content: SYSTEM_PROMPT + contractPrompt(input) }, { role: 'user', content: JSON.stringify(providerInput(input)) },
        { role: 'user', content: `${validationFeedback ?? 'Protocol reminder:'} ${input.ownNotes.length ? `目標延續規則：上次goal為${JSON.stringify(input.ownNotes.at(-1)!.goal)}。目標不變請逐字沿用；只要goal文字不同，就必須填寫非空白的revisionReason，不可為null。` : ''} Use EXACT action shapes from this JSON Schema. ${JSON.stringify(decisionSchemaFor(input))}` }],
      response_format: { type: 'json_schema', json_schema: { name: 'minority_decision', strict: true, schema: decisionSchemaFor(input) } } };
    const started = Date.now(); let responseBody: string | null = null; let status: number | null = null;
    const redact = (value: unknown): unknown => JSON.parse(JSON.stringify(value).split(this.key).join('[REDACTED]'));
    try {
      const response = await this.fetcher('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', signal,
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      status = response.status; responseBody = await response.text();
      if (!response.ok) throw new ProviderDecisionError(`http_${response.status}`, ![400,401,402,403,404,429].includes(response.status));
      const data = object(JSON.parse(responseBody));
      if (data.error || data.model !== this.llm.model) throw new Error('Model mismatch or provider error');
      if (!Array.isArray(data.choices) || data.choices.length !== 1) throw new Error('Expected one choice');
      const choice = object(data.choices[0]);
      if (choice.finish_reason === 'length') throw new ProviderDecisionError('output_token_limit', false);
      if (choice.finish_reason !== 'stop') throw new Error('Truncated or refused response');
      const message = object(choice.message);
      if (message.refusal || typeof message.content !== 'string') throw new Error('No usable output');
      const parsed = object(JSON.parse(message.content));
      const wake = object(parsed.nextWake); const note = object(parsed.strategyNote);
      if (wake.atGameTimeMs === null) delete wake.atGameTimeMs;
      if (note.revisionReason === null) delete note.revisionReason;
      const result = parseDecision(parsed);
      this.audit(input.snapshotId, redact({ kind: 'provider_response', success: true, started, finished: Date.now(), status, request: body, rawResponse: responseBody }) as Record<string, unknown>);
      return result;
    } catch (error) {
      const failure = error instanceof ProviderDecisionError ? error : new ProviderDecisionError('invalid_response', true);
      this.audit(input.snapshotId, redact({ kind: 'provider_response', success: false, code: failure.code, started, finished: Date.now(), status, request: body, rawResponse: responseBody }) as Record<string, unknown>);
      // Never propagate response bodies, private input or fetch error strings to the public surface.
      throw failure;
    }
  }
}
