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

/* ---------------- doodles ---------------- */
if (window.Doodle) {
  $('#markComb').innerHTML = Doodle.comb({ width: 30 });
  $('#heroComb').innerHTML = Doodle.comb({ honey: 'none', ink: '#FFC21A', sticker: '' }); // faint outline behind the title
  $('#beeSlot').innerHTML = Doodle.bee(84);
}
if (!CONFIGURED) $('#notConfigured').classList.remove('hidden');
$('#dropHint').textContent = `PDF, Word, or PowerPoint · up to ${CFG.maxFileMB || 20} MB`;

/* ---------------- class code: asked once, then hidden ---------------- */
$('#code').value = prefs.code || '';
const showCode = on => $('#codeCard').classList.toggle('hidden', !on);
showCode(!prefs.code);
$('#changeCode').addEventListener('click', () => { showCode(true); $('#code').focus(); });

/* ---------------- name (optional) ---------------- */
$('#uploader').value = prefs.uploader || '';
$('#section').value = prefs.section || '';

/* ---------------- course: honeycomb cells, remembered ---------------- */
const courseList = CFG.courses || [];
let course = prefs.course || '';
if (course && !courseList.includes(course)) { $('#courseOther').value = course; course = OTHER; }
{
  const cellBtn = (c, i) => `<button type="button" class="comb" role="radio" aria-checked="false" data-v="${esc(c)}">${window.Doodle ? Doodle.cell(31 + i) : ''}<span>${c === OTHER ? 'Other' : esc(c)}</span></button>`;
  /* rows of 3 then 2, nested into each other like a real comb (and like the logo) */
  const all = [...courseList, OTHER].map(cellBtn); let html = '';
  /* Balanced shapes: next rows differ by one cell, so each row sits in the gaps of the one above
     and the whole comb is mirror-symmetric. */
  const SHAPES = { 1: [1], 2: [2], 3: [2, 1], 4: [1, 2, 1], 5: [3, 2], 6: [2, 3, 1], 7: [2, 3, 2], 8: [3, 2, 3] };
  const rows = SHAPES[all.length] || all.map((_, r) => r % 2 ? 2 : 3);
  for (let i = 0, r = 0; i < all.length; r++) { const n = rows[r]; html += `<div class="comb-row">${all.slice(i, i + n).join('')}</div>`; i += n; }
  $('#combs').innerHTML = html;
}
function paintCombs() {
  document.querySelectorAll('.comb').forEach(b => b.setAttribute('aria-checked', String(b.dataset.v === course)));
  $('#courseOther').classList.toggle('hidden', course !== OTHER);
}
$('#combs').addEventListener('click', e => {
  const b = e.target.closest('.comb'); if (!b) return;
  course = b.dataset.v; paintCombs();
  if (course === OTHER) $('#courseOther').focus();
});
paintCombs();
const courseValue = () => course === OTHER ? $('#courseOther').value.trim() : course;

/* ---------------- current exam: set by the admin, students never pick it ---------------- */
const EXAMS = ['Prelim', 'Midterm', 'Finals'];
let examNow = EXAMS.includes(prefs.exam) ? prefs.exam : (CFG.defaultExamPeriod || 'Midterm');
(async () => {
  if (!CONFIGURED || !navigator.onLine) return;
  try {
    const r = await fetch(BASE + '/rest/v1/rpc/get_current_exam', { method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: '{}' });
    if (!r.ok) return;
    const v = await r.json();
    if (EXAMS.includes(v)) { examNow = v; prefs.exam = v; savePrefs(); }
  } catch (e) { /* offline: keep the last known exam */ }
})();

/* ---------------- subjects & teachers ---------------- */
const SUBJECTS = CFG.subjects || [];
const isShared = s => !s.courses || s.courses === 'all';
const inCourse = s => isShared(s) || !course || course === OTHER || (Array.isArray(s.courses) && s.courses.includes(course));
const subjectName = id => { const s = SUBJECTS.find(x => x.id === id); return s ? s.id + ' — ' + s.name : id; };
function subjectOptions(current) {
  const list = SUBJECTS.filter(inCourse), own = list.filter(s => !isShared(s)), shared = list.filter(isShared);
  const known = SUBJECTS.some(s => s.id === current);
  const opt = s => `<option value="${esc(s.id)}"${s.id === current ? ' selected' : ''}>${esc(s.id + ' — ' + s.name)}</option>`;
  return `<option value="">Not sure</option>` +
    (own.length ? `<optgroup label="${esc((course && course !== OTHER ? course : 'Course') + ' subjects')}">${own.map(opt).join('')}</optgroup>` : '') +
    (shared.length ? `<optgroup label="All CITCS courses">${shared.map(opt).join('')}</optgroup>` : '') +
    (known || !current ? '' : `<option value="${esc(current)}" selected>${esc(current)}</option>`) +
    `<option value="${OTHER}">Other subject…</option>`;
}
function renderTeachers() {
  const all = [...new Set([...(CFG.teachers || []), ...prefs.teachers])].sort((a, b) => a.localeCompare(b));
  $('#teacherList').innerHTML = all.map(t => `<option value="${esc(t)}">`).join('');
}
renderTeachers();
const TYPE_LIST = CFG.materialTypes || ['Lecture slides', 'Lesson / module', 'Handout / notes', 'Activity / exercise', 'Other'];

/* ---------------- picked files: checked, read, auto-filled ---------------- */
let picked = []; // {id, file, ok, reason, reading, readP, meta, found, open}

async function checkFile(file) {
  const ext = extOf(file.name);
  const t = TYPES[ext];
  if (!t) return 'Only PDF, Word (.doc, .docx) and PowerPoint (.ppt, .pptx) files';
  if (file.size === 0) return 'This file is empty';
  if (file.size > MAX_BYTES) return `Too big (${fmtSize(file.size)}). Max is ${CFG.maxFileMB || 20} MB. ${ext === 'pdf' ? 'Compress it or split it into parts.' : 'Save it as PDF, or compress the pictures in it.'}`;
  try {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (!SIGS[t.sig].every((b, i) => head[i] === b)) return 'This file is not really a ' + ext.toUpperCase() + ' file';
  } catch (e) { return 'Could not read this file'; }
  return '';
}

async function addFiles(list) {
  for (const file of list) {
    if (picked.some(p => p.file.name === file.name && p.file.size === file.size)) continue;
    const reason = await checkFile(file);
    const p = { id: uuid(), file, ok: !reason, reason, reading: !reason, open: false,
      meta: { subject: '', subjectOther: '', teacher: '', title: '', type: '', note: '' }, found: {} };
    picked.push(p);
    if (p.ok) {
      p.readP = (window.HiveAutofill ? HiveAutofill.read(file, SUBJECTS) : Promise.resolve(null))
        .catch(() => null)
        .then(res => {
          if (res) { Object.assign(p.meta, { subject: res.subject, teacher: res.teacher, title: res.title, type: res.type }); p.found = res.found; }
          if (!p.meta.type) p.meta.type = /pptx?$/.test(extOf(file.name)) ? 'Lecture slides' : 'Handout / notes';
          p.reading = false; renderPicked();
        });
    }
  }
  renderPicked();
}

function chip(text, missing) { return `<span class="chip${missing ? ' warn' : ''}">${esc(text)}</span>`; }

function renderPicked() {
  $('#picked').innerHTML = picked.map(p => {
    const m = p.meta;
    let body;
    if (!p.ok) body = `<p class="err">${esc(p.reason)}</p>`;
    else if (p.reading) body = `<p class="meta">Reading your file…</p>`;
    else if (!p.open) {
      const any = p.found.subject || p.found.teacher || p.found.title;
      body = `<p class="meta">${any ? 'We read your file and filled this in:' : "We couldn't read much from this file. Add what you know:"}</p>
        <div class="chips">${chip(m.subject ? (m.subject === OTHER ? (m.subjectOther || 'Other subject') : m.subject) : 'Subject?', !m.subject)}${chip(m.teacher || 'Teacher?', !m.teacher)}${m.title ? chip(m.title) : ''}</div>
        <button type="button" class="link" data-edit>Edit details</button>`;
    } else {
      body = `<div class="edit">
        <label>Subject<select data-f="subject">${subjectOptions(m.subject)}</select></label>
        <input type="text" data-f="subjectOther" class="${m.subject === OTHER ? '' : 'hidden'}" maxlength="80" placeholder="Subject code and name" value="${esc(m.subjectOther)}" aria-label="Other subject">
        <label>Teacher<input type="text" data-f="teacher" list="teacherList" maxlength="80" placeholder="Prof. Santos" value="${esc(m.teacher)}"></label>
        <label>Lesson<input type="text" data-f="title" maxlength="150" placeholder="Lecture 3: The Human Being" value="${esc(m.title)}"></label>
        <label>Type<select data-f="type">${TYPE_LIST.map(t => `<option${t === m.type ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>Note <span class="meta">(optional)</span><textarea data-f="note" maxlength="500" placeholder="Slides 10–20 are on the exam">${esc(m.note)}</textarea></label>
        <button type="button" class="small" data-done>Done</button></div>`;
    }
    return `<li class="pfile hand${p.ok ? '' : ' bad'}" data-id="${p.id}">
      <div class="pf-head"><span><span class="fname">${esc(p.file.name)}</span> <span class="meta">${fmtSize(p.file.size)}</span></span>
      <button type="button" class="x" data-remove aria-label="Remove ${esc(p.file.name)}">×</button></div>${body}</li>`;
  }).join('');
  const n = picked.filter(p => p.ok).length;
  $('#send').textContent = n > 1 ? `Send ${n} files to the hive` : 'Send to the hive';
}

const pickedOf = el => picked.find(p => p.id === el.closest('.pfile')?.dataset.id);
$('#picked').addEventListener('click', e => {
  const p = pickedOf(e.target); if (!p) return;
  if (e.target.closest('[data-remove]')) { picked = picked.filter(x => x !== p); renderPicked(); }
  else if (e.target.closest('[data-edit]')) { p.open = true; renderPicked(); }
  else if (e.target.closest('[data-done]')) { p.open = false; renderPicked(); }
});
['input', 'change'].forEach(ev => $('#picked').addEventListener(ev, e => {
  const f = e.target.dataset.f; const p = pickedOf(e.target); if (!f || !p) return;
  p.meta[f] = e.target.value;
  if (f === 'subject') e.target.closest('.edit').querySelector('[data-f=subjectOther]').classList.toggle('hidden', e.target.value !== OTHER);
}));

$('#files').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => addFiles([...(e.dataTransfer?.files || [])]));

/* ---------------- send → queue ---------------- */
async function sha256Hex(file) {
  if (!(window.crypto && crypto.subtle)) return uuid().replace(/-/g, '');
  const h = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkCodeOnline(code) {
  if (!CONFIGURED || !navigator.onLine) return null; // unknown, checked again on upload
  try {
    const r = await fetch(BASE + '/rest/v1/rpc/check_upload_code', {
      method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ code })
    });
    if (!r.ok) return null;
    return (await r.json()) === true;
  } catch (e) { return null; }
}

function showErr(msg) { const el = $('#formErr'); el.textContent = msg; el.classList.toggle('hidden', !msg); if (msg) el.scrollIntoView({ block: 'nearest' }); }
const CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;

$('#form').addEventListener('submit', async e => {
  e.preventDefault();
  showErr('');
  const code = ($('#code').value.trim() || prefs.code || '').toUpperCase();
  const courseVal = courseValue();
  const good = picked.filter(p => p.ok);

  if (!CODE_RE.test(code)) { showCode(true); $('#code').focus(); return showErr('Type the class code from the Discord server.'); }
  if (!courseVal) return showErr('Tap your course first.');
  if (!good.length) return showErr(picked.length ? 'None of these files can be sent. See the reasons above.' : 'Choose a file first.');

  const btn = $('#send'); btn.disabled = true; btn.textContent = 'Checking…';
  try {
    await Promise.all(good.map(p => p.readP));
    const valid = await checkCodeOnline(code);
    if (valid === false) { showCode(true); return showErr("That class code isn't right. Check the Discord server."); }

    Object.assign(prefs, { course: courseVal, code, uploader: $('#uploader').value.trim(), section: $('#section').value.trim() });
    for (const p of good) { const t = p.meta.teacher.trim(); if (t && !prefs.teachers.includes(t)) prefs.teachers = [t, ...prefs.teachers].slice(0, 40); }
    savePrefs(); renderTeachers();

    for (const p of good) {
      btn.textContent = 'Preparing ' + p.file.name + '…';
      const m = p.meta, ext = extOf(p.file.name);
      const subject = (m.subject === OTHER ? m.subjectOther : m.subject).trim();
      const item = {
        id: uuid(), createdAt: Date.now(), file: p.file, name: p.file.name, size: p.file.size,
        ext, mime: TYPES[ext].mime, sha256: await sha256Hex(p.file), code,
        meta: {
          course: courseVal, year_section: prefs.section || null,
          subject: (subject || 'Unknown').slice(0, 80), teacher: (m.teacher.trim() || 'Unknown').slice(0, 80),
          exam_period: examNow, material_type: m.type || null, title: m.title.trim().slice(0, 150) || null,
          uploader: prefs.uploader || null, note: m.note.trim().slice(0, 500) || null
        },
        stage: 'file', status: 'waiting', error: '', progress: 0, duplicate: false
      };
      await Store.put(item);
    }
    picked = []; renderPicked(); showCode(false);
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
  if (status === 401 || status === 403) return "Class code wasn't accepted. Fix it above, then tap Retry.";
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
        if (/class code/i.test(item.error)) showCode(true);
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
