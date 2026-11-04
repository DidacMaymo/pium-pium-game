// Todos los sonidos se sintetizan con WebAudio: cero ficheros de audio.
let ctx = null;
let master = null;

export function unlockAudio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function env(gainNode, t, peak, attack, decay) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

/** PIUUUM. volume 0..1 (el del rival se atenúa con la distancia). */
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
  osc.connect(filter); osc2.connect(filter); filter.connect(g); g.connect(master);
  osc.start(t); osc2.start(t); osc.stop(t + 0.3); osc2.stop(t + 0.3);
}

function noise(duration) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

export function hit() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = noise(0.2);
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = 1200;
  env(g, t, 0.6, 0.002, 0.18);
  src.connect(f); f.connect(g); g.connect(master);
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
  osc.connect(g); g.connect(master);
  osc.start(t); osc.stop(t + 1.3);
}

function tone(freqs, step, type = 'square', vol = 0.25) {
  const t = ctx.currentTime;
  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = f;
    env(g, t + i * step, vol, 0.005, step * 1.5);
    osc.connect(g); g.connect(master);
    osc.start(t + i * step); osc.stop(t + i * step + step * 2);
  });
}

export const respawn = () => ctx && tone([220, 330, 440, 660], 0.07, 'sine', 0.3);
export const beep = (high = false) => ctx && tone([high ? 880 : 440], 0.15, 'square', 0.2);
export const win = () => ctx && tone([523, 659, 784, 1047, 784, 1047], 0.1, 'square', 0.25);
export const lose = () => ctx && tone([392, 330, 262, 196], 0.18, 'sawtooth', 0.2);
