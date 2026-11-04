// Multijugador P2P sin servidor propio.
// Trystero usa relays públicos de Nostr SOLO para que los dos navegadores se encuentren
// (señalización WebRTC). Después, los datos del juego van directos navegador <-> navegador.
import { joinRoom } from 'trystero';

const APP_ID = 'pium-pium-laberinto-v1';

// Si alguna red no conecta (NAT estricto, 4G...), añade aquí un TURN gratuito,
// p.ej. Cloudflare TURN (free tier) o metered.ca Open Relay:
// [{ urls: 'turn:...', username: '...', credential: '...' }]
const TURN = [];

// Nombres de acción cortos (Trystero limita su longitud)
const ACTIONS = ['start', 'st', 'shot', 'hit', 'died', 'exit', 'end', 'again'];

export function createNet(roomCode, handlers) {
  const room = joinRoom({ appId: APP_ID, ...(TURN.length ? { turnConfig: TURN } : {}) }, roomCode);
  const send = {};
  for (const name of ACTIONS) {
    const action = room.makeAction(name);
    action.onMessage = (data, ctx) => handlers[name]?.(data, ctx.peerId);
    send[name] = (data = {}) => action.send(data).catch(() => {});
  }
  room.onPeerJoin = (id) => handlers.peerJoin?.(id);
  room.onPeerLeave = (id) => handlers.peerLeave?.(id);
  return { send, leave: () => room.leave() };
}
