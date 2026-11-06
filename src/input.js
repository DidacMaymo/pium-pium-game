// Filtro del ratón. Con el puntero capturado, Chrome en Windows envía a veces un evento con un salto
// enorme y falso: la cámara gira sola de golpe. Un salto así llega aislado y sin aceleración previa;
// un giro rápido de verdad va subiendo. Por eso se descarta solo un pico repentino, y si el siguiente
// evento también es grande se acepta (era movimiento real).

const SPIKE_PX = 200; // por debajo de esto nunca se considera pico
const SPIKE_RATIO = 6; // cuántas veces mayor que el evento anterior

export function createMouseFilter() {
  let prev = 0;
  let held = false;
  return {
    reset() { prev = 0; held = false; },
    /** ¿Se debe aplicar este movimiento? */
    accept(dx, dy) {
      const m = Math.hypot(dx, dy);
      if (m > SPIKE_PX && m > prev * SPIKE_RATIO && !held) {
        held = true;
        return false;
      }
      held = false;
      prev = m;
      return true;
    },
  };
}
