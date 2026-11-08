/* "Get app" button (add Hive to the home screen) and the "new version" bar. */
(() => {
const $ = s => document.querySelector(s);
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
/* Discord, Messenger, Facebook and other in-app browsers can't add to the home screen. */
const inApp = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Discord|Line\/|; wv\)/.test(ua) || (isIOS && !/Safari\//.test(ua));
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ---------------- Get app ---------------- */
const btn = $('#installBtn'), sheet = $('#installSheet');
let prompt = null;   // Chrome / Edge / Samsung's own install dialog, when the browser offers one

function paint() { btn.classList.toggle('hidden', installed() || !(prompt || isIOS || isAndroid)); }
addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; paint(); });
addEventListener('appinstalled', () => { prompt = null; paint(); if (sheet.open) sheet.close(); });
paint();

const SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9H6.5A1.5 1.5 0 0 0 5 10.5v8A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 17.5 9H16"/><path d="M12 14V3.5"/><path d="m8.5 7 3.5-3.5L15.5 7"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8.5v7M8.5 12h7"/></svg>';
function steps() {
  if (isIOS) return {
    first: 'Open this page in <b>Safari</b> first: tap <b>⋯</b> or the compass, then <b>Open in Safari</b>.',
    list: [`Tap <b>Share</b> ${SHARE} at the bottom of Safari.`,
           `Scroll down and tap <b>Add to Home Screen</b> ${PLUS}.`,
           'Tap <b>Add</b>. Hive is now on your home screen.'] };
  return {
    first: 'Open this page in <b>Chrome</b> first: tap <b>⋮</b>, then <b>Open in Chrome</b>.',
    list: ['Tap <b>⋮</b> at the top right of Chrome.',
           'Tap <b>Add to Home screen</b> or <b>Install app</b>.',
           'Tap <b>Install</b>. Hive is now on your home screen.'] };
}
btn.addEventListener('click', async () => {
  if (prompt) {
    const p = prompt; prompt = null;
    p.prompt(); await p.userChoice.catch(() => {});
    paint(); return;
  }
  const s = steps();
  $('#installSteps').innerHTML = s.list.map(t => `<li>${t}</li>`).join('');
  $('#installFirst').innerHTML = s.first;
  $('#installFirst').classList.toggle('hidden', !inApp);
  sheet.showModal();
});
$('#installOk').addEventListener('click', () => sheet.close());
sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });   // tap outside to close

/* ---------------- new version ---------------- */
if ('serviceWorker' in navigator) {
  const hadOne = !!navigator.serviceWorker.controller;   // first visit isn't an "update"
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadOne) $('#updateBar').classList.remove('hidden');
  });
  $('#updateBtn').addEventListener('click', () => location.reload());
  addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then(reg => {
      // an installed app can stay open for days: look for a new version whenever it comes back
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    }).catch(() => {});
  });
}
})();
