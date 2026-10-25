// Claude through the official SDK. The system prompt is cached; thinking is
// off and effort low, since an answer explains context it is handed. A model
// spec can turn thinking on: "claude-haiku-5-5+think" (effort low) or
// "claude-haiku-5-5+think:medium".

import Anthropic from '@anthropic-ai/sdk';
import { ModelError, type AskModel } from './types';

export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-5-5';

type Create = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

/** Thinking spends output tokens before the answer, so it gets this many times the answer's budget. */
const THINKING_BUDGET = 4;

export function parseSpec(spec: string): { model: string; think: boolean; effort: 'low' | 'medium' | 'high' } {
  const [model, think] = spec.split('+');
  const effort = think?.split(':')[1];
  return { model, think: think?.startsWith('think') ?? false, effort: effort === 'medium' || effort === 'high' ? effort : 'low' };
}

export function anthropicModel(apiKey: string, spec = DEFAULT_ANTHROPIC_MODEL, create?: Create): AskModel {
  const call = create ?? ((p) => new Anthropic({ apiKey }).messages.create(p));
  const { model, think, effort } = parseSpec(spec);
  // Haiku turns thinking off with 'disabled'; Sonnet 5.5 rejects that and uses 'between_tools'.
  const off = /^claude-sonnet-5-5/.test(model) ? 'between_tools' : 'disabled';
  return {
    id: `anthropic:${spec}`,
    async complete({ system, user, schema, maxTokens }) {
      let message: Anthropic.Message;
      try {
        message = await call({
          model,
          max_tokens: think ? maxTokens * THINKING_BUDGET : maxTokens,
          thinking: { type: think ? 'adaptive' : off } as Anthropic.ThinkingConfigParam,
          output_config: { effort, format: { type: 'json_schema', schema } },
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
        });
      } catch (e) {
        if (e instanceof Anthropic.RateLimitError) throw new ModelError('busy');
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new ModelError('auth');
        throw new ModelError('failed', e instanceof Error ? e.message : String(e));
      }
      const u = message.usage;
      const usage = u
        ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 }
        : undefined;
      if (message.stop_reason === 'refusal') return { kind: 'refused', usage, model: message.model };
      const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
      return { kind: 'text', text, usage, model: message.model, stop: message.stop_reason ?? undefined };
    },
  };
}
