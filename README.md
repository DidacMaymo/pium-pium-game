# Pium Pium Laberinto

Shooter láser en primera persona, de 2 a 8 jugadores. Cada ronda genera un mapa nuevo a partir de una semilla.

**Modos**
- **Laberinto**: gana quien encuentre antes la salida verde. Si te matan, estás 3 s fuera y reapareces
  en un sitio aleatorio, lejos de la salida y de los demás. Dificultad Fácil, Media o Difícil (tamaño del laberinto).
- **Arena**: todos contra todos en un mapa pequeño con pilares y cajas. Gana el primero que llega a 5, 10 o 20 bajas.
  Reapareces a los 2 s fuera de la vista de los rivales, con 1,5 s de invulnerabilidad.

**Power-ups** (flotan y brillan; caducan y se pierden al morir)
- ⚡ **Turbo**: corres un 75 % más rápido durante 8 s.
- ⇈ **Doble salto**: 12 s. Sirve para subir a las cajas altas de la arena.
- 🔫 **Láser automático**: mantén el clic para disparar en ráfaga durante 8 s.

**Ajustes**: sensibilidad del ratón, campo de visión, volumen de música y de efectos (se guardan en el navegador).

**Online sin servidor:** el multijugador es P2P (WebRTC) con [Trystero](https://github.com/dmotz/trystero).
Los relays públicos de Nostr solo sirven para que los dos navegadores se encuentren; después, la partida
va directa navegador a navegador. No hay que pagar ni mantener nada.

## Jugar

1. Uno elige el modo, pulsa **Crear sala** y pasa el enlace (o el código) a los demás.
2. Los demás abren el enlace y pulsan **Unirse**. Se puede entrar a mitad de partida.
3. El host pulsa **¡Empezar!**.
4. Clic en la pantalla para capturar el ratón. WASD moverse, Espacio saltar, clic disparar, Esc pausa, R otra ronda.

## Desarrollo

```bash
npm install
npm run dev
```

Para probar el multijugador en local, abre dos pestañas (o dos navegadores) en la URL que imprime Vite.

| Fichero | Qué hace |
| --- | --- |
| `src/maps.js` | Laberinto y arena con semilla (alturas por casilla: suelo, cajas, paredes) |
| `src/spawn.js` | Spawns iniciales justos y reaparición fuera de la vista de los enemigos |
| `src/game.js` | Escena Three.js, movimiento, saltos y colisiones, disparos, power-ups |
| `src/powerups.js` | Tipos de power-up, iconos dibujados en canvas, modelo flotante |
| `src/net.js` | Sala P2P con Trystero, acciones de red |
| `src/main.js` | Lobby, host/invitados, marcador, arbitraje de victoria y power-ups |
| `src/audio.js` | Efectos y música synthwave sintetizados con WebAudio |
| `src/settings.js` | Ajustes del jugador (localStorage) |

### Modelo de red

- Malla P2P: todos conectados con todos (bien hasta ~8 jugadores).
- El **host** (quien crea la sala) genera la semilla, lleva el marcador, reparte los power-ups
  y decide quién gana (así se evitan empates por latencia). Si el host se va, la partida termina.
- Cada jugador es autoridad de su propia posición. Los impactos los detecta quien dispara.
  Entre amigos sirve; no tiene protección contra trampas.
- Posición y orientación se envían a 20 Hz y se interpolan en el otro lado.

### Si no conectáis

Algunas redes (4G, redes corporativas, NAT estricto) bloquean el P2P directo. En ese caso,
añadid un servidor TURN gratuito (por ejemplo, el free tier de Cloudflare TURN) en `TURN` dentro de `src/net.js`.

## Publicar (gratis)

**GitHub Pages:** en *Settings → Pages → Source*, elige **GitHub Actions**. Cada push a la rama por defecto del repo se publica solo
(`.github/workflows/deploy.yml`).

**Cloudflare Pages** (alternativa): build command `npm run build`, output `dist`.
