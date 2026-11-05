// Todo el audio se sintetiza con WebAudio: cero ficheros. Música y efectos con volumen separado.
import { settings } from './settings.js';

let ctx = null;
let sfxBus = null;
let musicBus = null;

export function unlockAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    sfxBus = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus.connect(ctx.destination);
    musicBus.connect(ctx.destination);
    applyVolumes();
  }
  if (ctx.state === 'suspended') ctx.resume();
}

export function applyVolumes() {
  if (!ctx) return;
  sfxBus.gain.value = settings.sfx * 0.6;
  musicBus.gain.value = settings.music * 0.5;
  if (settings.music > 0) startMusic(); else stopMusic();
}

function env(gainNode, t, peak, attack, decay) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function noiseSource(duration) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function tone(freqs, step, type = 'square', vol = 0.25, bus = sfxBus) {
  const t = ctx.currentTime;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = f;
    env(g, t + i * step, vol, 0.005, step * 1.5);
    osc.connect(g); g.connect(bus);
    osc.start(t + i * step); osc.stop(t + i * step + step * 2);
  });
}

// ---------- Efectos ----------

/** PIUUUM. volume 0..1 (el de los rivales se atenúa con la distancia). */
export function laser(volume = 1, pitch = 1) {
  if (!ctx || volume <= 0.01) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  const g = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  osc.type = 'square';
  osc2.type = 'sawtooth';
  osc.frequency.setValueAtTime(2200 * pitch, t);
  osc.frequency.exponentialRampToValueAtTime(110 * pitch, t + 0.22);
  osc2.frequency.setValueAtTime(2230 * pitch, t);
  osc2.frequency.exponentialRampToValueAtTime(95 * pitch, t + 0.24);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(6000, t);
  filter.frequency.exponentialRampToValueAtTime(600, t + 0.25);
  env(g, t, 0.35 * volume, 0.005, 0.25);
  osc.connect(filter); osc2.connect(filter); filter.connect(g); g.connect(sfxBus);
  osc.start(t); osc2.start(t); osc.stop(t + 0.3); osc2.stop(t + 0.3);
}

export function hit() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = noiseSource(0.2);
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1200;
  env(g, t, 0.6, 0.002, 0.18);
  src.connect(f); f.connect(g); g.connect(sfxBus);
  src.start(t);
  tone([880, 1320], 0.06, 'square', 0.15);
}

export function death() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(600, t);
  osc.frequency.exponentialRampToValueAtTime(40, t + 1.2);
  env(g, t, 0.5, 0.01, 1.2);
  osc.connect(g); g.connect(sfxBus);
  osc.start(t); osc.stop(t + 1.3);
}

export function jump() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(260, t);
  osc.frequency.exponentialRampToValueAtTime(620, t + 0.12);
  env(g, t, 0.18, 0.005, 0.12);
  osc.connect(g); g.connect(sfxBus);
  osc.start(t); osc.stop(t + 0.2);
}

export function punch() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = noiseSource(0.12);
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  f.type = 'lowpass'; f.frequency.value = 900;
  env(g, t, 0.7, 0.002, 0.1);
  src.connect(f); f.connect(g); g.connect(sfxBus);
  src.start(t);
}

export function hurt() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(70, t + 0.15);
  env(g, t, 0.25, 0.003, 0.15);
  osc.connect(g); g.connect(sfxBus);
  osc.start(t); osc.stop(t + 0.2);
}

export function explosion(volume = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = noiseSource(1.2);
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(1800, t);
  f.frequency.exponentialRampToValueAtTime(80, t + 1.1);
  env(g, t, 0.9 * volume, 0.005, 1.1);
  src.connect(f); f.connect(g); g.connect(sfxBus);
  src.start(t);
  const osc = ctx.createOscillator();
  const g2 = ctx.createGain();
  osc.frequency.setValueAtTime(90, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.6);
  env(g2, t, 0.8 * volume, 0.005, 0.6);
  osc.connect(g2); g2.connect(sfxBus);
  osc.start(t); osc.stop(t + 0.7);
}

export function groan(volume = 1) {
  if (!ctx || volume < 0.05) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  osc.type = 'sawtooth';
  const base = 70 + Math.random() * 40;
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.linearRampToValueAtTime(base * 0.7, t + 0.8);
  f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 3;
  env(g, t, 0.3 * volume, 0.1, 0.8);
  osc.connect(f); f.connect(g); g.connect(sfxBus);
  osc.start(t); osc.stop(t + 1);
}

export const respawn = () => ctx && tone([220, 330, 440, 660], 0.07, 'sine', 0.3);
export const beep = (high = false) => ctx && tone([high ? 880 : 440], 0.15, 'square', 0.2);
export const win = () => ctx && tone([523, 659, 784, 1047, 784, 1047], 0.1, 'square', 0.25);
export const lose = () => ctx && tone([392, 330, 262, 196], 0.18, 'sawtooth', 0.2);
export const powerup = () => ctx && tone([523, 784, 1047, 1568], 0.05, 'triangle', 0.3);
export const powerdown = () => ctx && tone([784, 523], 0.08, 'triangle', 0.15);

// ---------- Música: synthwave procedural en bucle ----------

const BPM = 116;
const STEP = 60 / BPM / 4; // semicorcheas
// La menor - Fa - Do - Sol (raíces en Hz, octava grave)
const CHORDS = [
  [110, [220, 261.63, 329.63]],
  [87.31, [174.61, 220, 261.63]],
  [130.81, [261.63, 329.63, 392]],
  [98, [196, 246.94, 293.66]],
];
let timer = null;
let nextTime = 0;
let step = 0;

function scheduleStep(i, t) {
  const [root, chord] = CHORDS[Math.floor(i / 16) % CHORDS.length];
  const s = i % 16;

  // bajo en corcheas con salto de octava
  if (s % 2 === 0) {
    const osc = ctx.createOscillator();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = s % 4 === 2 ? root * 2 : root;
    f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 6;
    env(g, t, 0.35, 0.005, STEP * 1.6);
    osc.connect(f); f.connect(g); g.connect(musicBus);
    osc.start(t); osc.stop(t + STEP * 2);
  }
  // arpegio
  {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = chord[s % 3] * (s >= 8 ? 2 : 1);
    env(g, t, 0.06, 0.003, STEP * 0.9);
    osc.connect(g); g.connect(musicBus);
    osc.start(t); osc.stop(t + STEP);
  }
  // bombo
  if (s % 4 === 0) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    env(g, t, 0.7, 0.002, 0.15);
    osc.connect(g); g.connect(musicBus);
    osc.start(t); osc.stop(t + 0.2);
  }
  // hi-hat
  if (s % 4 === 2) {
    const src = noiseSource(0.05);
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    f.type = 'highpass'; f.frequency.value = 7000;
    env(g, t, 0.15, 0.001, 0.04);
    src.connect(f); f.connect(g); g.connect(musicBus);
    src.start(t);
  }
}

function startMusic() {
  if (timer || !ctx) return;
  nextTime = ctx.currentTime + 0.1;
  timer = setInterval(() => {
    while (nextTime < ctx.currentTime + 0.12) {
      scheduleStep(step++, nextTime);
      nextTime += STEP;
    }
  }, 25);
}

function stopMusic() {
  clearInterval(timer);
  timer = null;
}

// ---------- Munición y mundo zombi ----------

export function reloadSound() {
  if (!ctx) return;
  tone([220, 160, 300], 0.09, 'square', 0.12);
}

export function emptyClick() {
  if (!ctx) return;
  tone([900], 0.03, 'square', 0.1);
}

export function buySound() {
  if (!ctx) return;
  tone([520, 780], 0.07, 'triangle', 0.2);
}

export function doorSound() {
  if (!ctx) return;
  tone([110, 90, 70], 0.14, 'sawtooth', 0.22);
}

export function plankSound() {
  if (!ctx) return;
  tone([300, 240], 0.05, 'square', 0.14);
}

export function powerOnSound() {
  if (!ctx) return;
  tone([60, 90, 140, 220, 340, 520], 0.12, 'sawtooth', 0.22);
}

export function bossRoar() {
  if (!ctx) return;
  tone([95, 70, 55, 42], 0.3, 'sawtooth', 0.5);
}
