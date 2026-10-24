// Model gateway client. Phase 0 makes no model calls: every caller must work
// without a response. Later, the free tier can use an on-device model and the
// paid tier calls /api/llm, which caches responses and caps spend per user.

export interface LlmRequest {
  task: 'debrief-narrative' | 'scenario-narrative' | 'oral-question' | 'radio-grade';
  /** Structured facts the model may phrase but never change. */
  facts: unknown;
}

export async function llm(_req: LlmRequest): Promise<string | null> {
  return null;
}
