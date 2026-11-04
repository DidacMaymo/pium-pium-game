// Relay de señalización local para los tests multijugador.
import { createWsRelayServer } from '@trystero-p2p/ws-relay/server';

createWsRelayServer({ port: 8787 });
console.log('relay listo en ws://localhost:8787');
