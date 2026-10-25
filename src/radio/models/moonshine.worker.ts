// Moonshine, an open speech recognition model (MIT), turning a spoken call
// into text on the device. What it hears goes into the text box for the
// pilot to check, and is graded exactly like a typed call.

import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type { FromWorker, ToWorker } from './protocol';
import { hasWebGpu, progressTracker } from './progress';

const MODEL = 'onnx-community/moonshine-base-ONNX';
const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m);
// The pipeline factory's overloads are too wide for the compiler; this is the one used here.
const asrPipeline = pipeline as unknown as (task: 'automatic-speech-recognition', model: string, opts: object) => Promise<AutomaticSpeechRecognitionPipeline>;
let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

function load(): Promise<AutomaticSpeechRecognitionPipeline> {
  asr ??= (async () => {
    const gpu = await hasWebGpu();
    const p = await asrPipeline('automatic-speech-recognition', MODEL, {
      device: gpu ? 'webgpu' : 'wasm',
      dtype: gpu ? 'fp32' : 'q8',
      progress_callback: progressTracker((loaded, total) => post({ kind: 'progress', loaded, total })),
    });
    post({ kind: 'ready', device: gpu ? 'webgpu' : 'wasm' });
    return p;
  })();
  asr.catch(() => { asr = null; });
  return asr;
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.kind === 'load') await load();
    if (m.kind === 'transcribe') {
      const p = await load();
      const out = await p(m.audio);
      const text = (Array.isArray(out) ? out[0]?.text : out.text) ?? '';
      post({ kind: 'text', id: m.id, text: text.trim() });
    }
  } catch (err) {
    post({ kind: 'error', id: 'id' in m ? m.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
