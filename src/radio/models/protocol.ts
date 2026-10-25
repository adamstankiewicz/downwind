// Messages between the app and the model workers. Both models run off the
// main thread so the page stays responsive while they load and think.

export type ModelId = 'kokoro' | 'moonshine';

export type ToWorker =
  | { kind: 'load' }
  | { kind: 'speak'; id: number; text: string; voice: string; speed: number }
  | { kind: 'transcribe'; id: number; audio: Float32Array };

export type FromWorker =
  /** Download progress across the model files, 0 to 1. */
  | { kind: 'progress'; loaded: number; total: number }
  | { kind: 'ready'; device: 'webgpu' | 'wasm' }
  | { kind: 'audio'; id: number; samples: Float32Array; rate: number }
  | { kind: 'text'; id: number; text: string }
  | { kind: 'error'; id?: number; message: string };
