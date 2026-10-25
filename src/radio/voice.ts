// The controller's voice, when the pilot turns sound on. Sound is never
// required: the words are always on the page, and the app works the same
// with it off. Only voices that run on the device are used; a browser voice
// that sends its text to a server ("online" in the voice list) is left out.
//
// A speaker reads the spoken form of a transmission (speech.ts). Engines that
// hand back audio run it through the radio chain: a headset's narrow band,
// a little compression and static, and a squelch tail. The browser's own
// voices can't be routed through Web Audio, so they get the squelch only.

import { load, save } from '../lib/storage';
import { spoken } from './speech';
import { kokoroAudio, modelState } from './models/client';

export interface RadioPrefs {
  /** Speak the controller and the ATIS. Off until the pilot turns it on. */
  sound: boolean;
  /** Hide the controller's words until the pilot asks, so they copy by ear. */
  listenFirst: boolean;
  /** Headset band and static on voices that allow it. */
  radio: boolean;
  /** Browser voice name; null picks the first local English voice. */
  voice: string | null;
  /** Speaking rate. Controllers run a little quick. */
  rate: number;
  /** Who reads: Kokoro, or the device's own voice. The device reads while Kokoro is still loading. */
  engine: 'device' | 'kokoro';
  /** Kokoro voice id (models/client.ts, KOKORO_VOICES). */
  kokoroVoice: string;
  /** Show the hold-to-talk button once Moonshine is ready. Typing always works. */
  speechInput: boolean;
}

export const defaultRadioPrefs: RadioPrefs = {
  sound: false, listenFirst: false, radio: true, voice: null, rate: 1.15, engine: 'kokoro', kokoroVoice: 'am_michael', speechInput: true,
};
const KEY = 'downwind.radio.prefs.v2';
// v1 saved the old defaults (device voice, no speech input) whether or not
// the pilot picked them, so only its other settings carry over.
const OLD_KEY = 'downwind.radio.prefs.v1';
export function loadRadioPrefs(): RadioPrefs {
  const saved = load<Partial<RadioPrefs> | null>(KEY, null);
  if (saved) return { ...defaultRadioPrefs, ...saved };
  const { engine: _e, speechInput: _s, ...old } = load<Partial<RadioPrefs>>(OLD_KEY, {});
  return { ...defaultRadioPrefs, ...old };
}
export const saveRadioPrefs = (p: RadioPrefs) => save(KEY, p);

export interface DeviceVoice {
  name: string;
  lang: string;
}

function synth(): SpeechSynthesis | null {
  try {
    return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
  } catch {
    return null;
  }
}

/** English voices that run on this device, US and British first. */
export function deviceVoices(): DeviceVoice[] {
  const s = synth();
  if (!s) return [];
  const rank = (lang: string) => (/^en-US/i.test(lang) ? 0 : /^en-GB/i.test(lang) ? 1 : 2);
  return s.getVoices()
    .filter((v) => v.localService && /^en/i.test(v.lang))
    .sort((a, b) => rank(a.lang) - rank(b.lang))
    .map((v) => ({ name: v.name, lang: v.lang }));
}

/** Calls back when the device's voice list arrives or changes. Some browsers fill it in late. */
export function onVoicesChanged(cb: () => void): () => void {
  const s = synth();
  if (!s) return () => undefined;
  s.addEventListener('voiceschanged', cb);
  return () => s.removeEventListener('voiceschanged', cb);
}

export const canSpeak = () => synth() !== null;

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx ??= new AC();
    return ctx;
  } catch {
    return null;
  }
}

/** A short burst of band-limited static, like a squelch opening or closing. */
function squelch(ac: AudioContext, at: number, seconds = 0.12, level = 0.25) {
  const len = Math.ceil(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = 0.97 * last + 0.03 * (Math.random() * 2 - 1);
    d[i] = last * 4 * (1 - i / len);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500;
  bp.Q.value = 0.6;
  const g = ac.createGain();
  g.gain.value = level;
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(at);
}

/**
 * Plays decoded speech through the radio chain: a 350 to 3,000 Hz band,
 * compression, static under the voice and a squelch tail. Resolves when it
 * has finished; `stop` cuts it off.
 */
export function playOnRadio(buf: AudioBuffer, radio: boolean): { done: Promise<void>; stop: () => void } {
  const ac = audio();
  if (!ac) return { done: Promise.resolve(), stop: () => undefined };
  const src = ac.createBufferSource();
  src.buffer = buf;
  const nodes: AudioNode[] = [src];
  const t0 = ac.currentTime + (radio ? 0.1 : 0);
  if (radio) {
    squelch(ac, ac.currentTime, 0.1, 0.3);
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 350;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3000;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 8;
    const g = ac.createGain();
    g.gain.value = 1.4;
    src.connect(hp).connect(lp).connect(comp).connect(g).connect(ac.destination);
    nodes.push(hp, lp, comp, g);
    squelch(ac, t0 + buf.duration, 0.14, 0.3);
  } else {
    src.connect(ac.destination);
  }
  let finish = () => undefined as void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  src.onended = () => finish();
  src.start(t0);
  return {
    done,
    stop: () => {
      try { src.stop(); } catch { /* already stopped */ }
      nodes.forEach((n) => n.disconnect());
      finish();
    },
  };
}

let current: { stop: () => void } | null = null;

/** Stops whatever the controller is saying. */
export function stopSpeaking() {
  current?.stop();
  current = null;
  synth()?.cancel();
}

/**
 * Reads a transmission aloud: Kokoro when the pilot chose it and it is
 * loaded, otherwise a device voice. Resolves when it is done, or right away
 * when the device has no voice. Starting a new one stops the last.
 */
export async function speak(text: string, prefs: RadioPrefs): Promise<void> {
  stopSpeaking();
  if (prefs.engine === 'kokoro' && modelState('kokoro').status === 'ready') {
    const ac = audio();
    if (ac) {
      let cancelled = false;
      current = { stop: () => { cancelled = true; } };
      const token = current;
      try {
        // Kokoro reads a little slower than a browser voice at the same setting, so nudge it up.
        const { samples, rate } = await kokoroAudio(spoken(text), prefs.kokoroVoice, Math.min(1.5, prefs.rate * 1.05));
        if (cancelled || current !== token) return;
        await ac.resume();
        const buf = ac.createBuffer(1, samples.length, rate);
        buf.getChannelData(0).set(samples);
        const play = playOnRadio(buf, prefs.radio);
        current = play;
        return play.done;
      } catch {
        // Fall through to the device voice.
        if (cancelled) return;
      }
    }
  }
  return speakOnDevice(text, prefs);
}

function speakOnDevice(text: string, prefs: RadioPrefs): Promise<void> {
  const s = synth();
  if (!s) return Promise.resolve();
  const ac = audio();
  return new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(spoken(text));
    const voices = s.getVoices().filter((v) => v.localService && /^en/i.test(v.lang));
    const v = voices.find((x) => x.name === prefs.voice) ?? voices.find((x) => /^en-US/i.test(x.lang)) ?? voices[0];
    if (v) u.voice = v;
    u.rate = prefs.rate;
    const end = () => {
      if (prefs.radio && ac) squelch(ac, ac.currentTime);
      resolve();
    };
    u.onend = end;
    u.onerror = () => resolve();
    if (prefs.radio && ac) {
      void ac.resume();
      squelch(ac, ac.currentTime, 0.1, 0.3);
    }
    current = { stop: () => { s.cancel(); resolve(); } };
    s.speak(u);
  });
}
