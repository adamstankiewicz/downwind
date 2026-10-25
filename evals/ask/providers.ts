// The models the eval can run, all behind the worker's AskModel interface.
//   anthropic:<model>   Claude through the worker's own adapter (needs ANTHROPIC_API_KEY)
//   local:<hf repo>     an open-weight model through transformers.js, the same
//                       runtime the browser would use (ONNX, q4). Here it runs
//                       on CPU, so latency is a floor for slow devices, not a
//                       WebGPU number.
//   oracle              the reference answers, to prove the graders pass good answers
//   null                an empty answer, to prove the graders fail bad ones

import { anthropicModel } from '../../worker/models/anthropic';
import type { AskModel, ModelResult } from '../../worker/models/types';
import type { BuiltCase } from './cases';

/** Dollars per million tokens: input, output, cache read, cache write. */
export const PRICES: Record<string, [number, number, number, number]> = {
  'claude-haiku-5-5': [0.1, 0.5, 0.01, 0.125],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-opus-5-5': [4, 20, 0.2, 5],
};

export function costOf(modelId: string, r: ModelResult): number {
  const name = modelId.replace(/^anthropic:/, '');
  const p = PRICES[name];
  if (!p || !r.usage) return 0;
  const u = r.usage;
  return (u.inputTokens * p[0] + u.outputTokens * p[1] + (u.cacheReadTokens ?? 0) * p[2] + (u.cacheWriteTokens ?? 0) * p[3]) / 1e6;
}

export async function makeModel(spec: string, current: () => BuiltCase): Promise<AskModel> {
  if (spec === 'oracle') {
    return { id: 'oracle', complete: async () => ({ kind: 'text', text: JSON.stringify({ answer: current().reference, refs: current().referenceRefs ?? [] }) }) };
  }
  if (spec === 'null') return { id: 'null', complete: async () => ({ kind: 'text', text: '' }) };
  if (spec.startsWith('anthropic:')) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('anthropic models need ANTHROPIC_API_KEY');
    return anthropicModel(key, spec.slice('anthropic:'.length));
  }
  if (spec.startsWith('local:')) return localModel(spec.slice('local:'.length));
  throw new Error(`Unknown model ${spec}`);
}

async function localModel(repo: string): Promise<AskModel> {
  const { pipeline, env } = await import('@huggingface/transformers');
  if (process.env.HF_CACHE) env.cacheDir = process.env.HF_CACHE;
  const dtype = (process.env.ASK_EVAL_DTYPE ?? 'q4') as 'q4';
  const gen = await pipeline('text-generation', repo, { dtype });
  return {
    id: `local:${repo}`,
    async complete({ system, user, maxTokens }) {
      // No constrained decoding here, so the format instruction goes in the prompt,
      // as a browser build without a JSON grammar would have to do.
      const messages = [
        { role: 'system', content: `${system}\n\nReply with only a JSON object: {"answer": "...", "refs": ["..."]}` },
        { role: 'user', content: user },
      ];
      const out = await gen(messages, { max_new_tokens: maxTokens, do_sample: false }) as unknown as { generated_text: { content: string }[] }[];
      const text = out[0].generated_text.at(-1)?.content ?? '';
      const tok = gen.tokenizer;
      const prompt = tok.apply_chat_template(messages, { tokenize: false, add_generation_prompt: true } as never) as unknown as string;
      return { kind: 'text', text, model: repo, usage: { inputTokens: tok.encode(prompt).length, outputTokens: tok.encode(text).length } };
    },
  };
}
