// Utilidades puras (sin DOM): fáciles de testear.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para no confundir

export function randomCode(len = 5, rand = Math.random) {
  return Array.from({ length: len }, () => CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]).join('');
}

/** Limpia lo que escriban: minúsculas, espacios, o el enlace entero pegado. */
export function cleanCode(raw) {
  let s = String(raw ?? '').trim();
  const hash = s.lastIndexOf('#');
  if (hash !== -1) s = s.slice(hash + 1);
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/** 83.456 -> "1:23.46" */
export function fmtTime(s) {
  const t = Math.max(0, s);
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
}
