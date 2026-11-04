// Solo para tests: Trystero contra un relay WebSocket local en vez de los relays públicos de Nostr.
import { joinRoom as join, selfId } from '@trystero-p2p/ws-relay';

export { selfId };
export const joinRoom = (config, room) => join({ ...config, relayConfig: { urls: ['ws://localhost:8787'] } }, room);
