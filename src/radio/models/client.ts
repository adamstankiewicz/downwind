// The two optional models, from the app's side: a download the pilot starts
// on purpose, its progress, and calls into the workers. Nothing here loads
// until it is asked for, and the app works the same without either model.

import type { FromWorker, ModelId, ToWorker } from './protocol';

export const KOKORO_VOICES: { id: string; label: string }[] = [
  { id: 'am_michael', label: 'Michael, US' },
  { id: 'am_adam', label: 'Adam, US, deeper' },
  { id: 'am_fenrir', label: 'Fenrir, US, brisk' },
  { id: 'af_heart', label: 'Heart, US' },
  { id: 'af_bella', label: 'Bella, US' },
  { id: 'bm_george', label: 'George, British' },
  { id: 'bm_lewis', label: 'Lewis, British' },
];

/** What each model costs to download, for the pilot to see before they agree. */
export const MODEL_INFO: Record<ModelId, { name: string; mb: number; what: string; repo: string }> = {
  kokoro: { name: 'Kokoro', mb: 86, what: 'A natural controller voice', repo: 'onnx-community/Kokoro-82M-v1.0-ONNX' },
  moonshine: { name: 'Moonshine', mb: 63, what: 'Speak your calls instead of typing', repo: 'onnx-community/moonshine-base-ONNX' },
};

export interface ModelState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** 0 to 1 while downloading, when the size is known. */
  progress: number | null;
  device: 'webgpu' | 'wasm' | null;
  error: string | null;
}

const idle: ModelState = { status: 'idle', progress: null, device: null, error: null };
const states: Record<ModelId, ModelState> = { kokoro: idle, moonshine: idle };
const listeners = new Set<() => void>();
const workers: Partial<Record<ModelId, Worker>> = {};
const pending = new Map<number, { resolve: (m: FromWorker) => void; reject: (e: Error) => void }>();
let nextId = 1;

function set(id: ModelId, patch: Partial<ModelState>) {
  states[id] = { ...states[id], ...patch };
  listeners.forEach((l) => l());
}

export const modelState = (id: ModelId) => states[id];
export function subscribeModels(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function worker(id: ModelId): Worker {
  if (workers[id]) return workers[id]!;
  const w = id === 'kokoro'
    ? new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type: 'module' })
    : new Worker(new URL('./moonshine.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.kind === 'progress') set(id, { status: 'loading', progress: m.total ? m.loaded / m.total : null });
    else if (m.kind === 'ready') set(id, { status: 'ready', progress: 1, device: m.device, error: null });
    else if (m.kind === 'error' && m.id === undefined) set(id, { status: 'error', error: m.message });
    if ('id' in m && m.id !== undefined) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.kind === 'error') {
        p?.reject(new Error(m.message));
        if (states[id].status !== 'ready') set(id, { status: 'error', error: m.message });
      } else p?.resolve(m);
    }
  };
  w.onerror = (e) => set(id, { status: 'error', error: e.message || 'The model could not start on this device.' });
  workers[id] = w;
  return w;
}

/** Starts the download and load. Safe to call again; it loads once. */
export function loadModel(id: ModelId) {
  if (states[id].status === 'loading' || states[id].status === 'ready') return;
  set(id, { status: 'loading', progress: null, error: null });
  try {
    worker(id).postMessage({ kind: 'load' } satisfies ToWorker);
  } catch (e) {
    set(id, { status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

function call(id: ModelId, msg: ToWorker & { id: number }, transfer: Transferable[] = []): Promise<FromWorker> {
  return new Promise((resolve, reject) => {
    pending.set(msg.id, { resolve, reject });
    worker(id).postMessage(msg, transfer);
  });
}

/** True when the browser already has the model's files from an earlier download. */
export async function isDownloaded(id: ModelId): Promise<boolean> {
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    return keys.some((k) => k.url.includes(MODEL_INFO[id].repo) && k.url.endsWith('.onnx'));
  } catch {
    return false;
  }
}

/** Kokoro's reading of a line, as samples. Rejects when the model is not loaded or fails. */
export async function kokoroAudio(text: string, voice: string, speed: number): Promise<{ samples: Float32Array; rate: number }> {
  const m = await call('kokoro', { kind: 'speak', id: nextId++, text, voice, speed });
  if (m.kind !== 'audio') throw new Error('No audio came back.');
  return { samples: m.samples, rate: m.rate };
}

/** Moonshine's transcript of 16 kHz mono audio. */
export async function transcribe(audio: Float32Array): Promise<string> {
  const m = await call('moonshine', { kind: 'transcribe', id: nextId++, audio }, [audio.buffer]);
  if (m.kind !== 'text') throw new Error('No transcript came back.');
  return m.text;
}

/**
 * The microphone, while a button is held. `stop` gives back 16 kHz mono
 * samples, the rate the model expects. Only ever started by the pilot.
 */
export async function startRecording(): Promise<{ stop: () => Promise<Float32Array>; cancel: () => void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start();
  const release = () => stream.getTracks().forEach((t) => t.stop());
  return {
    cancel: () => { try { rec.stop(); } catch { /* not started */ } release(); },
    stop: () => new Promise<Float32Array>((resolve, reject) => {
      rec.onstop = async () => {
        release();
        try {
          const blob = new Blob(chunks, { type: rec.mimeType });
          const ac = new AudioContext({ sampleRate: 16000 });
          const buf = await ac.decodeAudioData(await blob.arrayBuffer());
          void ac.close();
          const out = new Float32Array(buf.length);
          for (let c = 0; c < buf.numberOfChannels; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
          }
          resolve(out);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      };
      rec.stop();
    }),
  };
}

export const canRecord = () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
