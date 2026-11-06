/* Admin page: sign in, review uploads, open/download files, approve or reject. */
(() => {
'use strict';
const CFG = window.APP_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MB = 1024 * 1024;
const fmtSize = n => n >= MB ? (n / MB).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const fmtDate = s => new Date(s).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const BUCKET = CFG.bucket || 'uploads';
const STATUSES = ['pending', 'approved', 'used', 'rejected'];
const ACTION_LABEL = { pending: 'Back to pending', approved: 'Approve', used: 'Mark used', rejected: 'Reject' };
const show = (id, on) => $(id).classList.toggle('hidden', !on);
const EXAMS = ['Prelim', 'Midterm', 'Finals', 'Other'];
const TYPES = CFG.materialTypes || [];
/* Auto-fill could not tell: the student page sends "Unknown" for these. */
const needsDetails = r => /^unknown$/i.test(r.subject || '') || /^unknown$/i.test(r.teacher || '');
const editing = new Set();

if (window.Doodle) {
  $('#markComb').innerHTML = Doodle.comb({ width: 30 });
  $('#heroComb').innerHTML = Doodle.comb({ honey: 'none', ink: '#FFC21A', sticker: '' });
}

const configured = /^https:\/\//.test(CFG.supabaseUrl || '') && !/YOUR-/.test((CFG.supabaseUrl || '') + (CFG.supabaseKey || ''));
if (!configured || !window.supabase) { show('#notConfigured', true); return; }

const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
let rows = [];

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 3000);
}

/* ---------- sign in ---------- */
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  show('#signOut', !!session);
  if (!session) { show('#loginCard', true); show('#dash', false); show('#notAdmin', false); return; }
  show('#loginCard', false);
  const { data: isAdmin } = await sb.rpc('is_admin');
  if (!isAdmin) { show('#notAdmin', true); return; }
  show('#dash', true);
  await Promise.all([load(), loadCode()]);
}

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#loginErr'); err.classList.add('hidden');
  const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#password').value });
  if (error) { err.textContent = error.message; err.classList.remove('hidden'); return; }
  $('#password').value = '';
  boot();
});
$('#signOut').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

/* ---------- data ---------- */
async function load() {
  const { data, error } = await sb.from('submissions').select('*').order('created_at', { ascending: false }).limit(2000);
  if (error) { toast('Could not load: ' + error.message); return; }
  rows = data || [];
  fillFilters(); renderStats(); renderCoverage(); renderList();
}

function fillLists() {
  const dl = (id, vals) => {
    let el = document.getElementById(id);
    if (!el) { el = document.createElement('datalist'); el.id = id; document.body.appendChild(el); }
    el.innerHTML = [...new Set(vals.filter(x => x && !/^unknown$/i.test(x)))].sort().map(x => `<option value="${esc(x)}">`).join('');
  };
  dl('subjectList', [...(CFG.subjects || []).map(s => s.id), ...rows.map(r => r.subject)]);
  dl('teacherAdminList', [...(CFG.teachers || []), ...rows.map(r => r.teacher)]);
}

function fillFilters() {
  fillLists();
  const keep = (sel, opts, label) => {
    const v = sel.value;
    sel.innerHTML = `<option value="">${label}</option>` + opts.map(o => `<option>${esc(o)}</option>`).join('');
    if (opts.includes(v)) sel.value = v;
  };
  keep($('#fCourse'), [...new Set([...(CFG.courses || []), ...rows.map(r => r.course)])], 'All courses');
  keep($('#fSubject'), [...new Set(rows.map(r => r.subject))].sort(), 'All subjects');
  keep($('#fPeriod'), [...new Set(rows.map(r => r.exam_period))], 'All exams');
}

function renderStats() {
  const c = s => rows.filter(r => r.status === s).length;
  const bytes = new Map(rows.map(r => [r.file_path, r.file_size]));
  const total = [...bytes.values()].reduce((a, b) => a + b, 0);
  $('#stats').innerHTML = [
    ['Pending', c('pending')], ['Approved', c('approved')], ['Used', c('used')],
    ['Rejected', c('rejected')], ['Storage', fmtSize(total)]
  ].map(([k, v]) => `<div class="stat"><b>${esc(v)}</b><span>${esc(k)}</span></div>`).join('');
}

/* Coverage: one table for shared subjects (all courses), then one per course ("comb"). */
function renderCoverage() {
  const periods = [...new Set([...(CFG.examPeriods || []), ...rows.map(r => r.exam_period)])];
  const cfgSubj = CFG.subjects || [];
  const isShared = id => { const s = cfgSubj.find(x => x.id === id); return !!s && (!s.courses || s.courses === 'all'); };
  const courses = [...new Set([...(CFG.courses || []), ...rows.map(r => r.course)])];

  const table = (subjects, match) => {
    const cell = (s, p) => {
      const rs = rows.filter(r => r.subject === s && r.exam_period === p && r.status !== 'rejected' && match(r));
      if (!rs.length) return '<td class="meta">—</td>';
      const ok = rs.filter(r => r.status !== 'pending').length;
      return `<td title="${ok} approved/used, ${rs.length - ok} pending">${rs.length}${ok ? ` <span class="meta">(${ok} ok)</span>` : ''}</td>`;
    };
    return `<table><tr><th>Subject</th>${periods.map(p => `<th>${esc(p)}</th>`).join('')}<th>Teachers</th></tr>` +
      subjects.map(s => {
        const teachers = [...new Set(rows.filter(r => r.subject === s && match(r)).map(r => r.teacher))];
        return `<tr><td><b>${esc(s)}</b></td>${periods.map(p => cell(s, p)).join('')}<td class="meta">${esc(teachers.join(', ') || '—')}</td></tr>`;
      }).join('') + '</table>';
  };

  const sharedSubjects = cfgSubj.filter(s => isShared(s.id)).map(s => s.id);
  let html = sharedSubjects.length ? `<h3>All CITCS courses</h3>${table(sharedSubjects, () => true)}` : '';
  for (const c of courses) {
    const own = [...new Set([
      ...cfgSubj.filter(s => Array.isArray(s.courses) && s.courses.includes(c)).map(s => s.id),
      ...rows.filter(r => r.course === c && !isShared(r.subject) && !/^unknown$/i.test(r.subject)).map(r => r.subject)
    ])];
    if (own.length) html += `<h3>${esc(c)}</h3>${table(own, r => r.course === c)}`;
  }
  $('#coverage').innerHTML = html || '<p class="empty">No subjects yet.</p>';
}

function filtered() {
  const st = $('#fStatus').value, cr = $('#fCourse').value, sj = $('#fSubject').value, pd = $('#fPeriod').value;
  const q = $('#fText').value.trim().toLowerCase();
  return rows.filter(r => (!st || (st === 'needs' ? needsDetails(r) && r.status !== 'rejected' : r.status === st)) && (!cr || r.course === cr) && (!sj || r.subject === sj) && (!pd || r.exam_period === pd) &&
    (!q || [r.teacher, r.title, r.file_name, r.uploader, r.course, r.year_section, r.note].join(' ').toLowerCase().includes(q)));
}

function renderList() {
  const list = filtered();
  const dupCount = new Map();
  rows.forEach(r => dupCount.set(r.sha256, (dupCount.get(r.sha256) || 0) + 1));
  $('#count').textContent = `${list.length} of ${rows.length} files`;
  const opts = (list, v) => [...new Set([...list, v].filter(Boolean))].map(o => `<option${o === v ? ' selected' : ''}>${esc(o)}</option>`).join('');
  const editBox = r => `
      <div class="editbox" data-edit>
        <div><label>Subject</label><input type="text" data-f="subject" list="subjectList" maxlength="80" value="${esc(r.subject)}"></div>
        <div><label>Teacher</label><input type="text" data-f="teacher" list="teacherAdminList" maxlength="80" value="${esc(r.teacher)}"></div>
        <div style="grid-column:1/-1"><label>Title</label><input type="text" data-f="title" maxlength="150" value="${esc(r.title || '')}"></div>
        <div><label>Exam</label><select data-f="exam_period">${opts(EXAMS, r.exam_period)}</select></div>
        <div><label>Type</label><select data-f="material_type"><option value="">—</option>${opts(TYPES, r.material_type)}</select></div>
      </div>
      <div class="actions"><button type="button" class="small" data-act="save" style="border-color:var(--honey);color:var(--honey)">Save details</button><button type="button" class="small" data-act="cancel">Cancel</button></div>`;
  $('#list').innerHTML = list.length ? list.map(r => `
    <div class="item" data-id="${esc(r.id)}">
      <div class="item-head">
        <div>
          <b>${esc(r.title || r.file_name)}</b>${needsDetails(r) ? '<span class="needs">needs details</span>' : ''}<br>
          <span class="meta">${esc(r.subject)} · ${esc(r.teacher)} · ${esc(r.exam_period)} · ${esc(r.material_type || '')}</span><br>
          <span class="meta">${esc(r.file_name)} · ${fmtSize(r.file_size)} · ${esc(r.course)}${r.year_section ? ' ' + esc(r.year_section) : ''} · ${esc(r.uploader || 'anonymous')} · ${fmtDate(r.created_at)}</span>
          ${dupCount.get(r.sha256) > 1 ? `<br><span class="dup">Same file uploaded ${dupCount.get(r.sha256)}×</span>` : ''}
          ${r.note ? `<br><span>“${esc(r.note)}”</span>` : ''}
          ${r.admin_note ? `<br><span class="meta">Your note: ${esc(r.admin_note)}</span>` : ''}
        </div>
        <span class="badge ${esc(r.status)}">${esc(r.status)}</span>
      </div>
      ${editing.has(r.id) ? editBox(r) : `<div class="actions">
        <button type="button" class="small" data-act="open">Open</button>
        <button type="button" class="small" data-act="download">Download</button>
        ${STATUSES.filter(s => s !== r.status).map(s => `<button type="button" class="small" data-act="status" data-status="${s}">${ACTION_LABEL[s]}</button>`).join('')}
        <button type="button" class="small" data-act="edit">Edit details</button>
        <button type="button" class="small" data-act="note">Note</button>
        <button type="button" class="small danger" data-act="delete">Delete</button>
      </div>`}
    </div>`).join('') : '<p class="empty" style="margin-top:12px">No files match.</p>';
}

['#fStatus', '#fCourse', '#fSubject', '#fPeriod'].forEach(s => $(s).addEventListener('change', renderList));
$('#fText').addEventListener('input', renderList);
$('#refresh').addEventListener('click', load);

$('#list').addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]'); if (!btn) return;
  const id = btn.closest('.item').dataset.id;
  const r = rows.find(x => x.id === id); if (!r) return;
  const act = btn.dataset.act;

  if (act === 'open' || act === 'download') {
    const win = window.open('', '_blank'); // open now so popup blockers allow it
    const { data, error } = await sb.storage.from(BUCKET)
      .createSignedUrl(r.file_path, 600, act === 'download' ? { download: r.file_name } : undefined);
    if (error || !data) { if (win) win.close(); toast('Could not open: ' + (error && error.message)); return; }
    if (win) win.location = data.signedUrl; else location.href = data.signedUrl;
    return;
  }
  if (act === 'edit') { editing.add(id); renderList(); return; }
  if (act === 'cancel') { editing.delete(id); renderList(); return; }
  if (act === 'save') {
    const box = btn.closest('.item');
    const v = f => box.querySelector(`[data-f="${f}"]`).value.trim();
    const upd = { subject: v('subject') || 'Unknown', teacher: v('teacher') || 'Unknown', title: v('title') || null,
      exam_period: v('exam_period'), material_type: v('material_type') || null };
    btn.disabled = true;
    const { error } = await sb.from('submissions').update(upd).eq('id', id);
    btn.disabled = false;
    if (error) return toast(error.message);
    Object.assign(r, upd); editing.delete(id); fillFilters(); toast('Details saved.');
  }
  if (act === 'status') {
    const { error } = await sb.from('submissions').update({ status: btn.dataset.status }).eq('id', id);
    if (error) return toast(error.message);
    r.status = btn.dataset.status;
  }
  if (act === 'note') {
    const note = prompt('Your note on this file (only you see it):', r.admin_note || '');
    if (note === null) return;
    const { error } = await sb.from('submissions').update({ admin_note: note.trim().slice(0, 500) || null }).eq('id', id);
    if (error) return toast(error.message);
    r.admin_note = note.trim() || null;
  }
  if (act === 'delete') {
    if (!confirm(`Delete "${r.file_name}" permanently? This cannot be undone.`)) return;
    const shared = rows.some(x => x.id !== id && x.file_path === r.file_path);
    if (!shared) {
      const { error } = await sb.storage.from(BUCKET).remove([r.file_path]);
      if (error) return toast('Could not delete file: ' + error.message);
    }
    const { error } = await sb.from('submissions').delete().eq('id', id);
    if (error) return toast(error.message);
    rows = rows.filter(x => x.id !== id);
    fillFilters();
  }
  renderStats(); renderCoverage(); renderList();
});

/* ---------- CSV export ---------- */
$('#csv').addEventListener('click', () => {
  const cols = ['created_at', 'status', 'course', 'year_section', 'subject', 'teacher', 'exam_period', 'material_type', 'title', 'file_name', 'file_size', 'uploader', 'note', 'admin_note', 'file_path'];
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? '"' + s.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""') + '"' : s; };
  const csv = [cols.join(','), ...filtered().map(r => cols.map(c => q(r[c])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = 'uploads-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------- upload code ---------- */
async function loadCode() {
  let { data, error } = await sb.from('app_settings').select('upload_code, current_exam').eq('id', 1).maybeSingle();
  if (error) { // setup.sql not re-run yet: no current_exam column
    ({ data } = await sb.from('app_settings').select('upload_code').eq('id', 1).maybeSingle());
    $('#examErr').textContent = 'Run supabase/setup.sql again to turn this on.'; show('#examErr', true);
    $('#saveExam').disabled = true;
  }
  if (data) {
    $('#codeInput').value = data.upload_code;
    $('#examInput').value = data.current_exam || CFG.defaultExamPeriod || 'Midterm';
  }
}
$('#saveExam').addEventListener('click', async () => {
  const exam = $('#examInput').value;
  const { error } = await sb.from('app_settings').update({ current_exam: exam }).eq('id', 1);
  if (error) { $('#examErr').textContent = error.message; show('#examErr', true); return; }
  show('#examErr', false);
  toast(`New uploads now go to ${exam}.`);
});
$('#saveCode').addEventListener('click', async () => {
  const code = $('#codeInput').value.trim().toUpperCase();
  const err = $('#codeErr');
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(code)) { err.textContent = 'Use 4–64 letters, numbers, - or _.'; err.classList.remove('hidden'); return; }
  err.classList.add('hidden');
  const { error } = await sb.from('app_settings').update({ upload_code: code }).eq('id', 1);
  if (error) { err.textContent = error.message; err.classList.remove('hidden'); return; }
  toast('Class code saved. Share the new one with your class.');
});

boot();
})();
