/* Hive — student upload page.
   Files are checked, saved in this browser (IndexedDB), then sent one by one
   with resumable uploads. If the signal drops they wait and continue later. */
(() => {
'use strict';

const CFG = window.APP_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MB = 1024 * 1024;
const MAX_BYTES = (CFG.maxFileMB || 20) * MB;
const BUCKET = CFG.bucket || 'uploads';
const BASE = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
const KEY = CFG.supabaseKey || '';
const CONFIGURED = /^https?:\/\//.test(BASE) && !/YOUR-/.test(BASE + KEY) && KEY.length > 20;
const OTHER = '__other__';

const TYPES = {
  pdf:  { mime: 'application/pdf', sig: 'pdf' },
  doc:  { mime: 'application/msword', sig: 'ole' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: 'zip' },
  ppt:  { mime: 'application/vnd.ms-powerpoint', sig: 'ole' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sig: 'zip' }
};
const SIGS = {
  pdf: [0x25, 0x50, 0x44, 0x46],                          // %PDF
  zip: [0x50, 0x4B, 0x03, 0x04],                          // PK.. (docx, pptx)
  ole: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]   // old .doc / .ppt
};

/* ---------------- small helpers ---------------- */
const fmtSize = n => n >= MB ? (n / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const extOf = name => (String(name).match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}
function authHeaders(extra) {
  const h = { apikey: KEY, ...extra };
  if (KEY.startsWith('eyJ')) h.authorization = 'Bearer ' + KEY; // legacy anon JWT key
  return h;
}

/* ---------------- saved preferences ---------------- */
const PREFS_KEY = 'hive.prefs.v1';
let prefs = {};
try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { prefs = {}; }
prefs.teachers = Array.isArray(prefs.teachers) ? prefs.teachers : [];
const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) {} };

/* ---------------- queue storage (IndexedDB, memory fallback) ---------------- */
const Store = (() => {
  const mem = new Map();
  let dbp = null;
  function open() {
    if (!dbp) dbp = new Promise((res, rej) => {
      if (!('indexedDB' in window)) return rej(new Error('no idb'));
      const r = indexedDB.open('hive', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(() => null);
    return dbp;
  }
  async function run(mode, fn) {
    const db = await open();
    if (!db) return fn(null);
    return new Promise((res, rej) => {
      const t = db.transaction('queue', mode);
      const req = fn(t.objectStore('queue'));
      t.oncomplete = () => res(req ? req.result : undefined);
      t.onerror = t.onabort = () => rej(t.error);
    });
  }
  return {
    persistent: async () => !!(await open()),
    all: () => run('readonly', s => s ? s.getAll() : [...mem.values()]),
    put: item => run('readwrite', s => s ? s.put(item) : (mem.set(item.id, item), null)),
    del: id => run('readwrite', s => s ? s.delete(id) : (mem.delete(id), null))
  };
})();

/* ---------------- build the form ---------------- */
function fillSelect(sel, options, current) {
  sel.innerHTML = options.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('');
  if (current != null && options.some(o => o.value === current)) sel.value = current;
}
const courses = (CFG.courses || []).map(c => ({ value: c, label: c }));
fillSelect($('#course'), [{ value: '', label: 'Choose…' }, ...courses, { value: OTHER, label: 'Other…' }], prefs.course);
if (prefs.course && !courses.some(c => c.value === prefs.course)) { $('#course').value = OTHER; $('#courseOther').value = prefs.course; }

/* Course picker as honeycomb cells; the hidden <select> stays the source of truth. */
$('#combs').innerHTML = [...courses, { value: OTHER, label: 'Other' }].map(c =>
  `<button type="button" class="comb" role="radio" aria-checked="false" data-v="${esc(c.value)}"><span>${esc(c.label)}</span></button>`).join('');
function paintCombs() {
  document.querySelectorAll('.comb').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === $('#course').value)));
}
$('#combs').addEventListener('click', e => {
  const b = e.target.closest('.comb'); if (!b) return;
  $('#course').value = b.dataset.v;
  $('#course').dispatchEvent(new Event('change'));
});
$('#course').addEventListener('change', paintCombs);
paintCombs();

/* Subjects: "all" = shared by every CITCS course; a list = only those courses. */
const isShared = s => !s.courses || s.courses === 'all';
const inCourse = (s, course) => isShared(s) || !course || course === OTHER || (Array.isArray(s.courses) && s.courses.includes(course));
function fillSubjects() {
  const sel = $('#subject');
  const course = $('#course').value;
  const keep = sel.value || prefs.subject || '';
  const list = (CFG.subjects || []).filter(s => inCourse(s, course));
  const own = list.filter(s => !isShared(s));
  const shared = list.filter(isShared);
  const opts = arr => arr.map(s => `<option value="${esc(s.id)}">${esc(s.id + ' — ' + s.name)}</option>`).join('');
  const ownLabel = course && course !== OTHER ? course + ' subjects' : 'Course subjects';
  sel.innerHTML = '<option value="">Choose…</option>' +
    (own.length ? `<optgroup label="${esc(ownLabel)}">${opts(own)}</optgroup>` : '') +
    (shared.length ? `<optgroup label="All CITCS courses">${opts(shared)}</optgroup>` : '') +
    `<option value="${OTHER}">Other subject…</option>`;
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
}
fillSubjects();

fillSelect($('#mtype'), (CFG.materialTypes || ['Lecture slides', 'Other']).map(m => ({ value: m, label: m })), prefs.mtype);

const periods = CFG.examPeriods || ['Prelim', 'Midterm', 'Finals'];
const periodNow = prefs.period && periods.includes(prefs.period) ? prefs.period : (CFG.defaultExamPeriod || periods[0]);
$('#period').innerHTML = periods.map(p =>
  `<label><input type="radio" name="period" value="${esc(p)}"${p === periodNow ? ' checked' : ''}><span>${esc(p)}</span></label>`).join('');

$('#section').value = prefs.section || '';
$('#uploader').value = prefs.uploader || '';
$('#code').value = prefs.code || '';
$('#dropHint').textContent = `PDF, Word, or PowerPoint · up to ${CFG.maxFileMB || 20} MB each`;

function renderTeachers() {
  const all = [...new Set([...(CFG.teachers || []), ...prefs.teachers])].sort((a, b) => a.localeCompare(b));
  $('#teacherList').innerHTML = all.map(t => `<option value="${esc(t)}">`).join('');
}
renderTeachers();

function toggleOther(sel, input) {
  const on = sel.value === OTHER;
  input.classList.toggle('hidden', !on);
  input.required = on;
  if (on) input.focus();
}
$('#course').addEventListener('change', () => {
  toggleOther($('#course'), $('#courseOther'));
  fillSubjects();
  if ($('#subject').value !== OTHER) $('#subjectOther').classList.add('hidden');
});
$('#subject').addEventListener('change', () => toggleOther($('#subject'), $('#subjectOther')));
toggleOther($('#course'), $('#courseOther'));
if ($('#course').value !== OTHER) $('#courseOther').classList.add('hidden');

if (!CONFIGURED) $('#notConfigured').classList.remove('hidden');

/* ---------------- file picking + checking ---------------- */
let picked = []; // {file, ok, reason}

async function checkFile(file) {
  const ext = extOf(file.name);
  const t = TYPES[ext];
  if (!t) return 'Only PDF, Word (.doc, .docx) and PowerPoint (.ppt, .pptx) files';
  if (file.size === 0) return 'This file is empty';
  if (file.size > MAX_BYTES) return `Too big (${fmtSize(file.size)}). Max is ${CFG.maxFileMB || 20} MB. ${ext === 'pdf' ? 'Compress it or split it into parts.' : 'Save it as PDF, or compress the pictures in it.'}`;
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const sig = SIGS[t.sig];
    if (!sig.every((b, i) => head[i] === b)) return 'This file is not really a ' + ext.toUpperCase() + ' file';
  } catch (e) { return 'Could not read this file'; }
  return '';
}

async function addFiles(list) {
  for (const file of list) {
    if (picked.some(p => p.file.name === file.name && p.file.size === file.size)) continue;
    const reason = await checkFile(file);
    picked.push({ file, ok: !reason, reason });
  }
  renderPicked();
}

function renderPicked() {
  $('#picked').innerHTML = picked.map((p, i) => `
    <li class="${p.ok ? '' : 'bad'}">
      <span><span class="fname">${esc(p.file.name)}</span><br><span class="meta">${p.ok ? fmtSize(p.file.size) : esc(p.reason)}</span></span>
      <button type="button" class="small" data-remove="${i}" aria-label="Remove ${esc(p.file.name)}">Remove</button>
    </li>`).join('');
  const n = picked.filter(p => p.ok).length;
  $('#send').textContent = n > 1 ? `Send ${n} files to the hive` : 'Send to the hive';
}

$('#files').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
$('#picked').addEventListener('click', e => {
  const i = e.target.getAttribute('data-remove');
  if (i != null) { picked.splice(+i, 1); renderPicked(); }
});
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles([...(e.dataTransfer?.files || [])]));

/* ---------------- submit → queue ---------------- */
async function sha256Hex(file) {
  if (!(window.crypto && crypto.subtle)) return uuid().replace(/-/g, '');
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkCodeOnline(code) {
  if (!CONFIGURED || !navigator.onLine) return null; // unknown, check later
  try {
    const r = await fetch(BASE + '/rest/v1/rpc/check_upload_code', {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ code })
    });
    if (!r.ok) return null;
    return (await r.json()) === true;
  } catch (e) { return null; }
}

function showErr(msg) { const el = $('#formErr'); el.textContent = msg; el.classList.toggle('hidden', !msg); if (msg) el.scrollIntoView({ block: 'nearest' }); }

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  showErr('');
  const course = $('#course').value === OTHER ? $('#courseOther').value.trim() : $('#course').value;
  const subjSel = $('#subject').value;
  const subject = subjSel === OTHER ? $('#subjectOther').value.trim() : subjSel;
  const teacher = $('#teacher').value.trim();
  const period = (document.querySelector('input[name=period]:checked') || {}).value;
  const code = $('#code').value.trim().toUpperCase();
  const good = picked.filter(p => p.ok);

  if (!course) return showErr('Tap your course (comb) first.');
  if (!subject) return showErr('Choose the subject.');
  if (!teacher) return showErr("Type the teacher's name.");
  if (!period) return showErr('Choose which exam this is for.');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) return showErr('Type the upload code from your class group chat.');
  if (!good.length) return showErr(picked.length ? 'None of the chosen files can be sent. See the reasons above.' : 'Choose at least one file.');

  const btn = $('#send'); btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const valid = await checkCodeOnline(code);
    if (valid === false) return showErr('That upload code is not right. Check the class group chat.');

    Object.assign(prefs, {
      course, section: $('#section').value.trim(), uploader: $('#uploader').value.trim(), code,
      subject: subjSel, period, mtype: $('#mtype').value
    });
    if (!prefs.teachers.includes(teacher)) prefs.teachers = [teacher, ...prefs.teachers].slice(0, 40);
    savePrefs(); renderTeachers();

    const meta = {
      course, year_section: prefs.section || null, subject, teacher, exam_period: periods.includes(period) && ['Prelim', 'Midterm', 'Finals'].includes(period) ? period : 'Other',
      material_type: $('#mtype').value || null, title: $('#title').value.trim() || null,
      uploader: prefs.uploader || null, note: $('#note').value.trim() || null
    };
    for (const p of good) {
      btn.textContent = 'Preparing ' + p.file.name + '…';
      const ext = extOf(p.file.name);
      const item = {
        id: uuid(), createdAt: Date.now(), file: p.file, name: p.file.name, size: p.file.size,
        ext, mime: TYPES[ext].mime, sha256: await sha256Hex(p.file), code, meta,
        stage: 'file', status: 'waiting', error: '', progress: 0, duplicate: false
      };
      await Store.put(item);
    }
    picked = []; renderPicked();
    $('#title').value = ''; $('#note').value = '';
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    toast(navigator.onLine ? 'Added to the hive. Sending now…' : 'Saved. It flies to the hive when you have signal.');
    await renderQueue();
    processQueue();
  } catch (err) {
    showErr('Could not save the files on this device: ' + (err && err.message || err));
  } finally {
    btn.disabled = false; renderPicked();
  }
});

/* ---------------- upload engine ---------------- */
const live = {}; // id -> progress (0..1), avoids rewriting IndexedDB on every chunk
const stalled = new Set(); // ids whose upload is retrying because the connection dropped
const sendingText = id => stalled.has(id) ? 'No signal — will keep trying' : 'Sending… ' + Math.round((live[id] || 0) * 100) + '%';
let running = false;

function explain(status, body) {
  if (status === 401 || status === 403) return 'Upload code was not accepted. Fix the code above, then tap Retry.';
  if (status === 413 || /too large|maximum allowed size/i.test(body)) return 'File is too large for the server.';
  if (status === 415 || /mime type|not supported/i.test(body)) return 'This file type is not allowed.';
  return 'Server said no (' + status + '). Tap Retry, or remove it.';
}

function uploadFile(item) {
  return new Promise((resolve, reject) => {
    if (!window.tus) return reject({ kind: 'network', message: 'Upload tool not loaded yet' });
    const up = new tus.Upload(item.file, {
      endpoint: BASE + '/storage/v1/upload/resumable',
      retryDelays: [0, 2000, 5000, 10000],
      headers: authHeaders({ 'x-upsert': 'false' }),
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * MB, // Supabase requires 6 MB chunks
      metadata: { bucketName: BUCKET, objectName: item.path, contentType: item.mime, cacheControl: '3600' },
      onProgress: (sent, total) => { live[item.id] = total ? sent / total : 0; stalled.delete(item.id); setNet(true); paintProgress(item.id); },
      onShouldRetry: err => {
        const st = err && err.originalResponse ? err.originalResponse.getStatus() : 0;
        if (st && st < 500 && st !== 408 && st !== 429) return false; // real refusal, don't retry
        stalled.add(item.id); setNet(false); paintProgress(item.id);
        return true;
      },
      onSuccess: () => resolve({ duplicate: false }),
      onError: err => {
        const res = err && err.originalResponse;
        const st = res ? res.getStatus() : 0;
        const body = res ? String(res.getBody() || '') : '';
        if (st === 409 || /already exists|duplicate/i.test(body)) return resolve({ duplicate: true });
        if (!st || st >= 500 || st === 408 || st === 429) return reject({ kind: 'network', message: 'No signal' });
        reject({ kind: 'fatal', message: explain(st, body) });
      }
    });
    up.findPreviousUploads()
      .then(prev => { if (prev.length) up.resumeFromPreviousUpload(prev[0]); up.start(); })
      .catch(() => up.start());
  });
}

async function insertRecord(item) {
  let r;
  try {
    r = await fetch(BASE + '/rest/v1/submissions', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({
        id: item.id, upload_code: item.code, file_path: item.path, file_name: item.name.slice(0, 200),
        file_size: item.size, file_type: item.mime, sha256: item.sha256, ...item.meta
      })
    });
  } catch (e) { throw { kind: 'network', message: 'No signal' }; }
  if (r.ok || r.status === 409) return;
  const body = await r.text().catch(() => '');
  if (r.status >= 500 || r.status === 408 || r.status === 429) throw { kind: 'network', message: 'Server busy' };
  throw { kind: 'fatal', message: explain(r.status, body) };
}

async function processQueue() {
  if (running || !CONFIGURED) return;
  running = true;
  try {
    for (;;) {
      const items = (await Store.all()).filter(i => i.status === 'waiting').sort((a, b) => a.createdAt - b.createdAt);
      const item = items[0];
      if (!item) break;
      item.path = `${item.code}/${item.sha256}.${item.ext}`;
      item.status = 'uploading'; item.error = '';
      await Store.put(item); await renderQueue();
      try {
        if (item.stage === 'file') {
          const { duplicate } = await uploadFile(item);
          item.duplicate = duplicate; item.stage = 'record';
          await Store.put(item);
        }
        await insertRecord(item);
        item.stage = 'done'; item.status = 'done'; item.file = null; item.doneAt = Date.now();
        await Store.put(item);
        setNet(true);
      } catch (err) {
        item.status = err && err.kind === 'fatal' ? 'failed' : 'waiting';
        item.error = (err && err.message) || 'Something went wrong';
        await Store.put(item); await renderQueue();
        if (item.status === 'waiting') { setNet(false); break; } // no signal: stop and try again later
      }
      delete live[item.id]; stalled.delete(item.id);
      await renderQueue();
    }
  } finally {
    running = false;
    await renderQueue();
  }
}

/* ---------------- queue list ---------------- */
function stateText(i) {
  if (i.status === 'done') return i.duplicate ? 'Sent ✓ (already had this file)' : 'Sent ✓';
  if (i.status === 'failed') return 'Not sent';
  if (i.status === 'uploading') return sendingText(i.id);
  if (!CONFIGURED) return 'Waiting (site not set up)';
  return i.error ? 'Waiting for signal' : 'Waiting';
}

async function renderQueue() {
  const items = (await Store.all()).sort((a, b) => b.createdAt - a.createdAt);
  $('#queueEmpty').classList.toggle('hidden', items.length > 0);
  $('#clearDone').classList.toggle('hidden', !items.some(i => i.status === 'done'));
  $('#queue').innerHTML = items.map(i => `
    <li data-id="${esc(i.id)}">
      <div class="q-head">
        <span class="fname">${esc(i.name)}</span>
        <span class="q-state ${esc(i.status)}" data-state>${esc(stateText(i))}</span>
      </div>
      <div class="meta">${esc(i.meta.subject)} · ${esc(i.meta.teacher)} · ${esc(i.meta.exam_period)} · ${fmtSize(i.size)}</div>
      ${i.status === 'uploading' ? `<div class="bar"><i data-bar style="width:${Math.round((live[i.id] || 0) * 100)}%"></i></div>` : ''}
      ${i.status === 'failed' ? `<p class="err">${esc(i.error)}</p>` : ''}
      ${i.status === 'failed' || i.status === 'waiting' ? `<div class="q-actions">
        <button type="button" class="small" data-retry="${esc(i.id)}">Retry</button>
        <button type="button" class="small danger" data-del="${esc(i.id)}">Remove</button></div>` : ''}
    </li>`).join('');
}

function paintProgress(id) {
  const li = document.querySelector(`#queue li[data-id="${CSS.escape(id)}"]`);
  if (!li) return;
  const pct = Math.round((live[id] || 0) * 100);
  const bar = li.querySelector('[data-bar]'); if (bar) bar.style.width = pct + '%';
  const st = li.querySelector('[data-state]'); if (st) st.textContent = sendingText(id);
}

$('#queue').addEventListener('click', async e => {
  const retry = e.target.getAttribute('data-retry');
  const del = e.target.getAttribute('data-del');
  const items = await Store.all();
  if (retry) {
    const it = items.find(i => i.id === retry); if (!it) return;
    const code = $('#code').value.trim().toUpperCase();
    if (/^[A-Za-z0-9_-]{4,64}$/.test(code) && code !== it.code) { it.code = code; prefs.code = code; savePrefs(); }
    it.status = 'waiting'; it.error = '';
    await Store.put(it); await renderQueue(); processQueue();
  }
  if (del && confirm('Remove this file from the list? It will not be sent.')) {
    await Store.del(del); await renderQueue();
  }
});

$('#clearDone').addEventListener('click', async () => {
  for (const i of await Store.all()) if (i.status === 'done') await Store.del(i.id);
  renderQueue();
});

/* ---------------- connection status ---------------- */
function setNet(on) {
  const el = $('#net');
  el.textContent = on ? 'Online' : 'Offline — files will wait';
  el.className = 'pill ' + (on ? 'on' : 'off');
}
setNet(navigator.onLine);
window.addEventListener('online', () => { setNet(true); processQueue(); });
window.addEventListener('offline', () => setNet(false));
document.addEventListener('visibilitychange', () => { if (!document.hidden) processQueue(); });
setInterval(async () => {
  if (!running && (await Store.all()).some(i => i.status === 'waiting')) processQueue();
}, 20000);

/* ---------------- start ---------------- */
(async () => {
  // Anything left "uploading" from a closed tab goes back to waiting (it resumes where it stopped).
  for (const i of await Store.all()) if (i.status === 'uploading') { i.status = 'waiting'; await Store.put(i); }
  if (!(await Store.persistent())) toast('This browser cannot keep files offline. Keep this page open until they send.');
  await renderQueue();
  processQueue();
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
})();
