// Kokoro, an open text-to-speech model (Apache 2.0), reading the controller's
// lines on the device. Downloaded once when the pilot asks for it, then
// cached by the browser.

import { KokoroTTS } from 'kokoro-js';
import type { FromWorker, ToWorker } from './protocol';
import { hasWebGpu, progressTracker } from './progress';

type KokoroVoice = NonNullable<NonNullable<Parameters<KokoroTTS['generate']>[1]>['voice']>;

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const post = (m: FromWorker, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);
let tts: Promise<KokoroTTS> | null = null;

function load(): Promise<KokoroTTS> {
  tts ??= (async () => {
    const gpu = await hasWebGpu();
    const t = await KokoroTTS.from_pretrained(MODEL, {
      dtype: gpu ? 'fp32' : 'q8',
      device: gpu ? 'webgpu' : 'wasm',
      progress_callback: progressTracker((loaded, total) => post({ kind: 'progress', loaded, total })),
    });
    post({ kind: 'ready', device: gpu ? 'webgpu' : 'wasm' });
    return t;
  })();
  tts.catch(() => { tts = null; });
  return tts;
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    if (m.kind === 'load') await load();
    if (m.kind === 'speak') {
      const t = await load();
      // Voice ids are Kokoro's own ("am_michael"), listed once in models/client.ts.
      const out = await t.generate(m.text, { voice: m.voice as KokoroVoice, speed: m.speed });
      const samples = out.audio as Float32Array;
      post({ kind: 'audio', id: m.id, samples, rate: out.sampling_rate }, [samples.buffer]);
    }
  } catch (err) {
    post({ kind: 'error', id: 'id' in m ? m.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
