# Pium Pium Laberinto

Shooter láser en primera persona, de 1 a 8 jugadores (y bots). Cada ronda genera un mapa nuevo o usa uno dibujado a mano.

**Modos**
- **Laberinto**: gana quien encuentre antes la salida verde. Si te matan, reapareces lejos de la salida.
  Dificultad Fácil, Media o Difícil (tamaño del laberinto). Solo láser.
- **Arena**: todos contra todos. Gana el primero a 5, 10 o 20 bajas. Reapareces fuera de la vista de los rivales.
- **Juego de armas**: cada baja te da el arma siguiente (pistola → subfusil → rifle → escopeta → francotirador → láser).
  Gana quien consiga una baja con la última.
- **Zombis**: cooperativo por oleadas en un búnker enorme de 9 salas. Empiezas con pistola; todo lo demás se paga con puntos. Perdéis si caéis todos a la vez.
- **Parkour**: carrera sobre lava con checkpoints y cronómetro. Solo contra el reloj (se guarda tu récord) o contra amigos.
  7 niveles: los 4 últimos, de dificultad media-difícil, son dentro de edificios (Almacén, Torre de oficinas, Hospital y Sótano).
- **Entrenamiento**: 5 blancos (fijos, móviles y lejanos) para practicar con cada arma; mide precisión y tiempo por serie.

**Bots** (Laberinto, Arena, Juego de armas): de 1 a 7, en Fácil, Normal o Difícil. Se puede jugar solo contra bots.

**Armas**: pistola, subfusil, rifle, escopeta, francotirador (clic derecho para apuntar con mira; es la que más daña), láser y,
solo en la caja de zombis, la pistola de rayos.
Vida 100, se regenera a los 4 s sin recibir daño, y los disparos a la cabeza hacen ×1,5.

**Munición** (todos los modos): cada arma tiene cargador y una reserva finita. **R** recarga, y recarga sola al vaciar el cargador.
Al reaparecer se rellena, y en el Juego de armas cada arma nueva llega llena. En zombis no: hay que comprarla.

**Mapas de arena**: Coliseo, Torres, Pasillos y Aleatoria. Tienen pistones que te elevan, muros deslizantes
y barriles explosivos (con reacción en cadena).

**Zombis**: si caes, esperas a que tu equipo supere la oleada (o a que te revivan). Empiezas con 500 puntos y ganas 10 por impacto,
100 por zombi, 250 por oleada superada en pie y 10 por tabla reparada. Todo se usa acercándote y pulsando **E**:
- **Puertas**: abren salas nuevas (de 750 a 1500 puntos). Los zombis solo salen de las zonas abiertas.
- **Armas en la pared**: las compras, y si ya la tienes compras munición a mitad de precio. Llevas 2 como máximo: la tercera sustituye a la de la mano.
- **Caja misteriosa** (950, en el patio central): un arma al azar, incluida la pistola de rayos.
- **Ventanas y puertas de servicio**: por ahí entran los zombis, tras romper las tablas. Mantén **E** para repararlas.
- **Carpintero** (500, en la sala inicial): repara todas las ventanas del mapa.
- **Munición** (1000, en el patio central): rellena todas tus armas.
- **Granadas** (500 por 2, en la sala inicial): empiezas con 2 y llevas 4 como máximo.
- **Revivir a un compañero**: un caído se queda tumbado donde cayó. Mantén **E** a su lado 2,5 s para levantarlo, gratis y con 100 puntos de premio.
- **Electricidad** (gratis, en la sala del noroeste): hay que llegar hasta ella. Sin luz no funciona ninguna máquina.
- **Máquinas** (mejoras fijas hasta que caes): Botiquín, Revivir equipo, Segunda Vida, Puño de Hierro (el puñetazo con **V** revienta zombis),
  Refresco Blindado (200 de vida), Cola Doble Tiro, Recarga Exprés y Pack-a-Pium (doble daño).
- **Power-ups en el suelo**: efectos momentáneos (turbo, ráfaga, gravedad lunar...). Ninguno regala armas.
- **Zombi rojo**: cada 7 oleadas llega uno mucho más grande y resistente que muerde fuerte. Matarlo da 1000 puntos extra y munición llena a todo el equipo.

Cada zombi lleva su vida encima, en barra y en número. No hay plataformas: los zombis pueden llegar a cualquier sitio.

**Granadas (G)** en Arena y Zombis: rebotan y explotan a los 1,8 s. Las paredes protegen, y en zombis no dañan a los compañeros.

**Minimapa**: en Zombis se va descubriendo lo que ves, con compañeros y zombis a la vista. En Arena y Juego de armas se ve todo el mapa,
y los rivales solo aparecen como un punto rojo cuando disparan.

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
4. Clic en la pantalla para capturar el ratón. WASD moverse, Espacio saltar, clic disparar, clic derecho apuntar, R recargar,
   E usar (zombis), G granada, 1-6 o la rueda para cambiar de arma, Esc pausa. Al acabar, R otra ronda; el host puede pulsar M para
   cambiar de modo sin salir de la sala. En Entrenamiento, T reinicia.

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
| `src/mapdefs.js` | **Mapas dibujados en texto**: arenas, búnker zombi, campo de tiro y niveles de parkour |
| `src/weapons.js` | Armas: daño, cadencia, dispersión, modelo 3D |
| `src/bots.js` | IA de bots y zombis (camino más corto por la rejilla, puntería según dificultad) |
| `src/spawn.js` | Spawns iniciales justos y reaparición fuera de la vista de los enemigos |
| `src/game.js` | Escena Three.js, movimiento, saltos y colisiones, vida, disparos, power-ups, parkour, entrenamiento |
| `src/powerups.js` | Tipos de power-up, iconos dibujados en canvas, modelo flotante |
| `src/net.js` | Sala P2P con Trystero, acciones de red |
| `src/shop.js` | Máquinas zombi: mejoras, precios y reglas de compra |
| `src/zombieworld.js` | Mundo zombi: puertas, ventanas, caja, armas de pared, oleadas y zombi rojo (lógica pura) |
| `src/util.js` | Códigos de sala, formato de tiempos |
| `src/input.js` | Filtro del ratón: descarta los saltos falsos que hacían girar la cámara sola |
| `src/grenades.js` | Física y daño de las granadas |
| `src/minimap.js` | Minimapa: descubrimiento en zombis y disparos en rojo |
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
