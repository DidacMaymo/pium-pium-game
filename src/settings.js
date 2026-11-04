// Ajustes del jugador, guardados en este navegador.
const KEY = 'pium-pium-settings';

export const settings = { name: '', sens: 1, fov: 80, music: 0.35, sfx: 0.8 };

try {
  Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}'));
} catch { /* modo privado o storage bloqueado: usamos los valores por defecto */ }

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* sin persistencia */ }
}
