import { Game } from './game.js';
import { createNet } from './net.js';
import { unlockAudio } from './audio.js';

const $ = (id) => document.getElementById(id);

const hud = {
  overlay: (show) => ($('overlay').hidden = !show),
  message(main, sub = '') { $('msg-main').textContent = main; $('msg-sub').textContent = sub; },
  dead: (on) => $('dead').classList.toggle('on', on),
  deadCountdown: (n) => ($('dead-count').textContent = Math.max(0, n)),
  clickToPlay: (on) => $('click').classList.toggle('on', on),
  hitmarker() {
    const el = $('hitmarker');
    el.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('on')));
  },
  score({ wins, kills, deaths, solo }) {
    $('score').textContent = solo
      ? 'MODO PRÁCTICA'
      : `Victorias  tú ${wins.me} – ${wins.them} rival\nBajas ${kills}   Muertes ${deaths}`;
  },
};

const game = new Game($('app'), hud);

let net = null;
let role = null; // 'host' | 'guest' | 'solo'
let peer = null;
let wins = { me: 0, them: 0 };
let currentSeed = null;

const newSeed = () => (Math.random() * 2 ** 32) >>> 0;
const randomCode = () =>
  Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');

function showLobby() {
  $('lobby').hidden = false;
  $('waiting').hidden = true;
  hud.overlay(true);
}

function showWaiting(title, code) {
  $('lobby').hidden = true;
  $('waiting').hidden = false;
  $('wait-title').textContent = title;
  $('share').hidden = !code;
  if (code) {
    $('room-code').textContent = code;
    $('room-link').value = `${location.origin}${location.pathname}#${code}`;
  }
  hud.overlay(true);
}

function leave() {
  net?.leave();
  net = null;
  peer = null;
  role = null;
  wins = { me: 0, them: 0 };
  game.stop('', '');
  history.replaceState(null, '', location.pathname);
  showLobby();
}

// ---------- Rondas ----------

function hostStartRound() {
  currentSeed = newSeed();
  net.send.start({ seed: currentSeed });
  game.startRound({ seed: currentSeed, role: 'host', wins });
}

function declareWinner(winner) {
  // Solo el host decide quién ha ganado (evita empates por latencia)
  if (game.ended) return;
  net.send.end({ w: winner, r: currentSeed });
  applyEnd(winner);
}

function applyEnd(winner) {
  const iWon = winner === role;
  if (iWon) wins.me++; else wins.them++;
  game.endRound(iWon, wins);
}

game.onReachExit = () => {
  if (role === 'solo') game.endRound(true, wins);
  else if (role === 'host') declareWinner('host');
  else net.send.exit({ r: currentSeed });
};

game.onRematch = () => {
  if (role === 'solo') game.startRound({ seed: newSeed(), role: 'host', solo: true, wins });
  else if (role === 'host' && peer) hostStartRound();
  else if (role === 'guest') { net.send.again(); hud.message('Revancha pedida…', 'Esperando al host'); }
};

// ---------- Red ----------

function connect(code) {
  net = createNet(code, {
    peerJoin(id) {
      if (peer) return; // 1v1: ignoramos terceros
      peer = id;
      if (role === 'host') hostStartRound();
      else $('wait-title').textContent = 'Conectado. Esperando al host…';
    },
    peerLeave(id) {
      if (id !== peer) return;
      peer = null;
      wins = { me: 0, them: 0 };
      game.stop('Tu rival se ha ido', '');
      if (role === 'host') showWaiting('Rival desconectado. Esperando otro…', code);
      else showWaiting('El host se ha ido.', null);
    },
    start({ seed }, from) {
      if (role !== 'guest' || from !== peer) return;
      currentSeed = seed;
      game.startRound({ seed, role: 'guest', wins });
    },
    st: (data, from) => from === peer && game.remoteState(data),
    shot: (data, from) => from === peer && game.remoteShot(data),
    hit: (data, from) => from === peer && game.gotHit(data),
    died: (data, from) => from === peer && game.opponentDied(data),
    exit({ r }, from) {
      if (role === 'host' && from === peer && r === currentSeed) declareWinner('guest');
    },
    end({ w, r }, from) {
      if (role === 'guest' && from === peer && r === currentSeed) applyEnd(w);
    },
    again(_, from) {
      if (role === 'host' && from === peer && game.ended) hostStartRound();
    },
  });
  game.net = {
    st: net.send.st, shot: net.send.shot, hit: net.send.hit, died: net.send.died,
  };
}

// ---------- UI ----------

$('btn-create').onclick = () => {
  unlockAudio();
  role = 'host';
  const code = randomCode();
  history.replaceState(null, '', `#${code}`);
  showWaiting('Esperando rival…', code);
  connect(code);
};

function join(code) {
  code = code.trim().toUpperCase();
  if (!code) return;
  unlockAudio();
  role = 'guest';
  history.replaceState(null, '', `#${code}`);
  showWaiting(`Buscando la sala ${code}…`, null);
  connect(code);
}

$('btn-join').onclick = () => join($('input-code').value);
$('input-code').onkeydown = (e) => e.key === 'Enter' && join($('input-code').value);

$('btn-solo').onclick = () => {
  unlockAudio();
  role = 'solo';
  game.net = null;
  game.startRound({ seed: newSeed(), role: 'host', solo: true, wins });
};

$('btn-copy').onclick = () => {
  navigator.clipboard?.writeText($('room-link').value);
  $('btn-copy').textContent = '¡Copiado!';
  setTimeout(() => ($('btn-copy').textContent = 'Copiar'), 1200);
};

$('btn-cancel').onclick = leave;

// Si abres un enlace con #CODIGO, precargamos el código (hace falta un clic para el audio)
const hashCode = location.hash.slice(1);
if (hashCode) {
  $('input-code').value = hashCode;
  $('btn-join').focus();
}
showLobby();
if (import.meta.env.DEV) window.__game = game; // depuración desde la consola
