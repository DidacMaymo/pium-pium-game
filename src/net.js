// Multijugador P2P sin servidor propio.
// Trystero usa relays públicos de Nostr SOLO para que los navegadores se encuentren
// (señalización WebRTC). Después, los datos del juego van directos entre navegadores (malla P2P).
import { joinRoom, selfId } from 'trystero';

export { selfId };

const APP_ID = 'pium-pium-laberinto-v1';

// Si alguna red no conecta (NAT estricto, 4G...), añade aquí un TURN gratuito,
// p.ej. Cloudflare TURN (free tier) o metered.ca Open Relay:
// [{ urls: 'turn:...', username: '...', credential: '...' }]
const TURN = [];

// Nombres de acción cortos (Trystero limita su longitud a 12 bytes)
const ACTIONS = [
  'hi', 'start', 'st', 'shot', 'hit', 'died', 'exit', 'end', 'again', 'sc', 'pus', 'pick', 'got',
  'ents',  // host -> todos: posiciones de bots y zombis
  'ehit',  // -> host: daño a un bot, zombi o barril
  'boom',  // host -> todos: un barril explota
  'brl',   // host -> todos: barriles destruidos
  'wave',  // host -> todos: estado de la oleada zombi
  'buy',   // -> host: compra en la tienda (zombis)
  'rev',   // host -> todos: revivir a los caídos
];

export function createNet(roomCode, handlers) {
  const room = joinRoom({ appId: APP_ID, ...(TURN.length ? { turnConfig: TURN } : {}) }, roomCode);
  const send = {};
  for (const name of ACTIONS) {
    const action = room.makeAction(name);
    action.onMessage = (data, ctx) => handlers[name]?.(data, ctx.peerId);
    // target opcional: id de un peer (o lista). Sin target => a todos.
    send[name] = (data = {}, target) => action.send(data, target ? { target } : undefined).catch(() => {});
  }
  room.onPeerJoin = (id) => handlers.peerJoin?.(id);
  room.onPeerLeave = (id) => handlers.peerLeave?.(id);
  return { send, leave: () => room.leave() };
}
