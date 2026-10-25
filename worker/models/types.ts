// The worker talks to any model through this. Ask the instructor needs one
// thing: a system prompt and a user turn in, the reply text out. Adapters
// map their own errors onto ModelError so the handler can answer calmly.

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export type ModelResult =
  | { kind: 'text'; text: string; usage?: Usage; model?: string; stop?: string }
  | { kind: 'refused'; usage?: Usage; model?: string };

export interface AskModel {
  /** What the adapter calls, such as `anthropic:claude-haiku-5-5`. */
  id: string;
  /** `strong` is set when the question is one the cheap model gets wrong too often; a router uses it, others ignore it. */
  complete(prompt: { system: string; user: string; schema: Record<string, unknown>; maxTokens: number; strong?: boolean }): Promise<ModelResult>;
}

export class ModelError extends Error {
  constructor(readonly reason: 'busy' | 'auth' | 'failed', message?: string) {
    super(message ?? reason);
  }
}
