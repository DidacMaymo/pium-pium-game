# Pium Pium Laberinto

Shooter láser 1v1 en primera persona dentro de un laberinto. Gana el primero que encuentra la salida verde.
Si te matan, estás 3 segundos fuera y reapareces en un punto aleatorio, lejos de la salida y de tu rival.
Cada ronda genera un laberinto nuevo a partir de una semilla.

**Online sin servidor:** el multijugador es P2P (WebRTC) con [Trystero](https://github.com/dmotz/trystero).
Los relays públicos de Nostr solo sirven para que los dos navegadores se encuentren; después, la partida
va directa navegador a navegador. No hay que pagar ni mantener nada.

## Jugar

1. Uno pulsa **Crear sala** y le pasa el enlace (o el código) al otro.
2. El otro abre el enlace y pulsa **Unirse**.
3. Clic en la pantalla para capturar el ratón. WASD para moverse, clic para disparar, R para la revancha.

## Desarrollo

```bash
npm install
npm run dev
```

Para probar el multijugador en local, abre dos pestañas (o dos navegadores) en la URL que imprime Vite.

| Fichero | Qué hace |
| --- | --- |
| `src/maze.js` | Laberinto con semilla, spawns iniciales justos, reaparición aleatoria |
| `src/game.js` | Escena Three.js, movimiento y colisiones, disparos, muerte y reaparición |
| `src/net.js` | Sala P2P con Trystero, acciones de red |
| `src/main.js` | Lobby, roles host/invitado, arbitraje de victoria |
| `src/audio.js` | Sonidos láser sintetizados con WebAudio |

### Modelo de red

- El **host** genera la semilla, la envía y decide quién gana (así se evitan empates por latencia).
- Cada jugador es autoridad de su propia posición. Los impactos los detecta quien dispara.
  Entre amigos sirve; no tiene protección contra trampas.
- Posición y orientación se envían a 20 Hz y se interpolan en el otro lado.

### Si no conectáis

Algunas redes (4G, redes corporativas, NAT estricto) bloquean el P2P directo. En ese caso,
añadid un servidor TURN gratuito (por ejemplo, el free tier de Cloudflare TURN) en `TURN` dentro de `src/net.js`.

## Publicar (gratis)

**GitHub Pages:** en *Settings → Pages → Source*, elige **GitHub Actions**. Cada push a `main` se publica solo
(`.github/workflows/deploy.yml`).

**Cloudflare Pages** (alternativa): build command `npm run build`, output `dist`.
