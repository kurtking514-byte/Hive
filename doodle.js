/* Hive doodles: hand-drawn honeycomb, course cells and a bee, drawn as SVG.
   The wobble comes from a seeded random, so each drawing looks hand-made
   but stays the same on every load. */
(function (g) {
'use strict';
function rnd(s) { return function () { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function pt(cx, cy, r, a) { return [cx + r * Math.cos(a * Math.PI / 180), cy + r * Math.sin(a * Math.PI / 180)]; }
const f = n => n.toFixed(1);

/* A pointy-top hexagon with slightly uneven corners. */
function hex(cx, cy, r, seed, wobble) {
  const R = rnd(seed), j = () => (R() - 0.5) * r * (wobble || 0.12);
  return [-90, -30, 30, 90, 150, 210].map((a, i) => { const p = pt(cx, cy, r, a); return (i ? 'L' : 'M') + f(p[0] + j()) + ' ' + f(p[1] + j()); }).join('') + 'Z';
}
/* The little inner highlight stroke along the upper-left of a cell. */
function shine(cx, cy, r, seed) {
  const R = rnd(seed + 7), j = () => (R() - 0.5) * r * 0.08, k = r * 0.7;
  return [160, 210, 270, 305].map((a, i) => { const p = pt(cx, cy, k, a); return (i ? 'L' : 'M') + f(p[0] + j()) + ' ' + f(p[1] + j()); }).join('');
}

const CELLS = [[42, 44, 1], [111, 44, 2], [180, 38, 3], [77, 104, 4], [146, 104, 5]];

/* The Hive comb: five cells, ink outline, optional cream "sticker" edge. */
function comb(o) {
  o = Object.assign({ ink: '#1B1408', honey: '#FFC21A', sticker: '#F6EBD5', width: 80, label: '' }, o || {});
  const r = 38;
  let s = `<svg viewBox="-12 -16 246 182" width="${o.width}" ${o.label ? `role="img" aria-label="${o.label}"` : 'aria-hidden="true"'} xmlns="http://www.w3.org/2000/svg">`;
  if (o.sticker) CELLS.forEach(c => { s += `<path d="${hex(c[0], c[1], r, c[2])}" fill="${o.sticker}" stroke="${o.sticker}" stroke-width="16" stroke-linejoin="round"/>`; });
  CELLS.forEach(c => {
    s += `<path d="${hex(c[0], c[1], r, c[2])}" fill="${o.honey}" stroke="${o.ink}" stroke-width="7" stroke-linejoin="round"/>`;
    s += `<path d="${shine(c[0], c[1], r, c[2])}" fill="none" stroke="${o.ink}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  return s + '</svg>';
}

/* A single course cell outline (colours come from CSS). Even, so a row of them lines up. */
function cell() {
  return `<svg viewBox="0 0 70 70" aria-hidden="true"><path d="${hex(35, 35, 29, 1, 0)}" stroke-width="3.5" stroke-linejoin="round"/></svg>`;
}

/* A doodled bee for empty and success states. */
function bee(width) {
  const ink = '#1B1408', honey = '#FFC21A', cream = '#F6EBD5';
  return `<svg viewBox="0 0 124 96" width="${width || 96}" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<g fill="none" stroke="${cream}" stroke-width="13" stroke-linejoin="round" stroke-linecap="round">
<path d="M52 36C40 8 18 15 29 33C35 42 47 40 52 36Z"/><path d="M63 33C68 5 93 9 81 31C75 41 65 39 63 33Z"/>
<path d="M30 60C29 42 50 35 71 39C89 43 99 53 97 63C95 75 79 81 60 79C41 78 30 73 30 60Z"/>
<path d="M23 46C32 46 36 53 35 60C34 68 27 72 20 70C13 68 10 61 12 55C14 49 18 46 23 46Z"/></g>
<g stroke="${ink}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round">
<path d="M52 36C40 8 18 15 29 33C35 42 47 40 52 36Z" fill="${cream}"/><path d="M63 33C68 5 93 9 81 31C75 41 65 39 63 33Z" fill="${cream}"/>
<path d="M30 60C29 42 50 35 71 39C89 43 99 53 97 63C95 75 79 81 60 79C41 78 30 73 30 60Z" fill="${honey}"/>
<path d="M51 42C47 53 47 67 51 78M67 41C63 53 63 67 67 79" fill="none" stroke-width="7"/>
<path d="M97 63L110 66L96 70" fill="none"/>
<path d="M23 46C32 46 36 53 35 60C34 68 27 72 20 70C13 68 10 61 12 55C14 49 18 46 23 46Z" fill="${honey}"/>
<path d="M18 47C14 36 10 32 5 32M26 46C26 36 30 30 35 29" fill="none" stroke-width="4"/></g>
<circle cx="19" cy="56" r="3" fill="${ink}"/></svg>`;
}

const api = { hex, shine, comb, cell, bee };
g.Doodle = api;
if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
