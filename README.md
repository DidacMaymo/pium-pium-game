# Pium Pium Laberinto

Shooter láser en primera persona, de 1 a 8 jugadores (y bots). Cada ronda genera un mapa nuevo o usa uno dibujado a mano.

**Modos**
- **Laberinto**: gana quien encuentre antes la salida verde. Si te matan, reapareces lejos de la salida.
  Dificultad Fácil, Media o Difícil (tamaño del laberinto). Solo láser.
- **Arena**: todos contra todos. Gana el primero a 5, 10 o 20 bajas. Reapareces fuera de la vista de los rivales.
- **Juego de armas**: cada baja te da el arma siguiente (pistola → subfusil → rifle → escopeta → francotirador → láser).
  Gana quien consiga una baja con la última.
- **Zombis**: cooperativo por oleadas, cada vez más zombis, más rápidos y más duros. Perdéis si caéis todos a la vez.
- **Parkour**: carrera sobre lava con checkpoints y cronómetro. Solo contra el reloj (se guarda tu récord) o contra amigos.
- **Entrenamiento**: 5 blancos (fijos, móviles y lejanos) para practicar con cada arma; mide precisión y tiempo por serie.

**Bots** (Laberinto, Arena, Juego de armas): de 1 a 7, en Fácil, Normal o Difícil. Se puede jugar solo contra bots.

**Armas**: pistola, subfusil, rifle, escopeta, francotirador (clic derecho para apuntar con mira) y láser.
Vida 100, se regenera a los 4 s sin recibir daño, y los disparos a la cabeza hacen ×1,5.

**Mapas de arena**: Coliseo, Torres, Pasillos y Aleatoria. Tienen pistones que te elevan, muros deslizantes
y barriles explosivos (con reacción en cadena).

**Zombis**: si caes, esperas a que tu equipo supere la oleada (o a que te revivan). Puntos: 10 por impacto,
100 por zombi y 250 por oleada superada en pie. Con **B** abres la tienda: Botiquín, Revivir equipo,
Segunda Vida, Puño de Hierro (el puñetazo con **V** revienta zombis), Refresco Blindado (200 de vida),
Cola Doble Tiro y Pack-a-Pium (doble daño). Las mejoras se pierden al caer.

**Puñetazo (V)** en todos los modos con armas. En el Juego de armas, un puñetazo *humilla*: la víctima baja de nivel.

**Power-ups** (rotan: nunca hay más de 2 del mismo tipo; caducan y se pierden al morir)
- ⚡ **Turbo** ×1,75 durante 8 s · ⚡⚡ **Hipervelocidad** ×2 durante 5 s
- ⇈ **Doble salto** 12 s · 🔫 **Ráfaga**: cualquier arma automática y más rápida durante 8 s
- 🎯 **Francotirador** durante 15 s · ✚ **Botiquín**: vida al máximo
- 🌙 **Gravedad lunar**: saltos flotantes durante 10 s · 👻 **Fantasma**: casi invisible 8 s (los bots solo te ven de cerca)

**Ajustes**: sensibilidad del ratón, campo de visión, volumen de música y de efectos (se guardan en el navegador).

## Jugar

1. Uno elige el modo, pulsa **Crear sala** y pasa el enlace (o el código) a los demás.
2. Los demás abren el enlace y pulsan **Unirse** (con el enlace solo ven el botón de unirse),
   o escriben el código en el menú principal. Se puede entrar a mitad de partida.
3. El host pulsa **¡Empezar!**.
4. Clic en la pantalla para capturar el ratón. WASD moverse, Espacio saltar, clic disparar, clic derecho apuntar,
   1-6 o la rueda para cambiar de arma, Esc pausa, R otra ronda.

## Desarrollo

```bash
npm install
npm run dev
```

Para probar el multijugador en local, abre dos pestañas (o dos navegadores) en la URL que imprime Vite.

### Tests (ejecútalos antes de subir cambios)

```bash
npm run check
```

```bash
npm run test:e2e
```

- `npm run check`: lint (ESLint) + tests unitarios (Vitest) + comprobación de los niveles de parkour. Tarda segundos.
- `npm run test:e2e`: abre navegadores reales (Playwright) y juega cada modo; el multijugador se prueba con
  dos navegadores conectados por un relay local (`tests/e2e/support/`), sin depender de internet.
  La primera vez: `npx playwright install chromium`.
- GitHub Actions ejecuta todo en cada push y **solo publica la web si todo pasa** (`.github/workflows/ci.yml`).
- En modo desarrollo la consola tiene `window.__game`, `window.__bots` y `window.__roster()` para depurar.

| Fichero | Qué hace |
| --- | --- |
| `src/maps.js` | Laberinto y arena aleatoria con semilla, lector de mapas en texto, objetos móviles |
| `src/mapdefs.js` | **Mapas dibujados en texto**: arenas, campo de tiro y niveles de parkour |
| `src/weapons.js` | Armas: daño, cadencia, dispersión, modelo 3D |
| `src/bots.js` | IA de bots y zombis (camino más corto por la rejilla, puntería según dificultad) |
| `src/spawn.js` | Spawns iniciales justos y reaparición fuera de la vista de los enemigos |
| `src/game.js` | Escena Three.js, movimiento, saltos y colisiones, vida, disparos, power-ups, parkour, entrenamiento |
| `src/powerups.js` | Tipos de power-up, iconos dibujados en canvas, modelo flotante |
| `src/net.js` | Sala P2P con Trystero, acciones de red |
| `src/shop.js` | Tienda zombi: precios y reglas de compra |
| `src/util.js` | Códigos de sala, formato de tiempos |
| `src/parkourCheck.js` | Comprueba con la física del juego que un nivel de parkour se puede superar |
| `tests/unit/` | Tests unitarios (Vitest) |
| `tests/e2e/` | Tests en navegador (Playwright) |
| `src/main.js` | Lobby, host/invitados, marcador, arbitraje de victoria, power-ups, barriles, oleadas zombi |
| `src/audio.js` | Efectos y música synthwave sintetizados con WebAudio |
| `src/settings.js` | Ajustes del jugador (localStorage) |

### Hacer tus propios mapas

Abre `src/mapdefs.js`: cada mapa es un dibujo en texto donde cada carácter es una casilla de 3×3 m
(la leyenda está al principio del fichero). Añade una entrada a `ARENA_MAPS` o `PARKOUR_LEVELS` y aparecerá
sola en el menú. Para los niveles de parkour, comprueba que se pueden superar con la física del juego:

```bash
npm run check-parkour
```

### Modelo de red

- Malla P2P: todos conectados con todos (bien hasta ~8 jugadores).
- El **host** (quien crea la sala) genera la semilla, lleva el marcador, reparte los power-ups,
  simula los bots y los zombis, gestiona los barriles y decide quién gana (así se evitan empates por latencia).
  Si el host se va, la partida termina.
- Los objetos móviles (pistones, muros, plataformas) no se envían por red: se mueven según el tiempo
  de la ronda, igual en todos los ordenadores.
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
