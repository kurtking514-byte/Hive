/* Hive navigation + reviewer.
   - First open: "Review or Upload?" (asked once, remembered).
   - Header icon: Upload <-> Review.
   - Review: subjects by course or Everything -> a subject -> lesson -> Notes | Quiz tabs.
   Notes and quizzes live in reviewer/ (lessons.json, notes/<id>.txt, quiz/<id>.json). */
(() => {
'use strict';
const CFG = window.APP_CONFIG || {};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* own storage, so it never fights with the upload page's saved settings */
const KEY = 'hive.review.v1';
let st = {};
try { st = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { st = {}; }
st.best = st.best || {}; st.quiz = st.quiz || {};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} };
const uploadCourse = () => { try { return (JSON.parse(localStorage.getItem('hive.prefs.v1')) || {}).course || ''; } catch (e) { return ''; } };

const COURSES = CFG.courses || [];
const SUBJECTS = CFG.subjects || [];
const isShared = s => !s.courses || s.courses === 'all';
let LESSONS = null;

const ICON_UP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18.5h-.6A4.4 4.4 0 0 1 6 9.7a6 6 0 0 1 11.6 1.1h.4a3.9 3.9 0 0 1 0 7.7h-1"/><path d="M12 20.5v-9"/><path d="m8.6 14.6 3.4-3.4 3.4 3.4"/></svg>';
const ICON_BOOK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.5c-2-1.6-4.6-2.2-8-2v13.2c3.4-.2 6 .4 8 2"/><path d="M12 6.5c2-1.6 4.6-2.2 8-2v13.2c-3.4-.2-6 .4-8 2V6.5Z"/></svg>';

/* ---------------- data ---------------- */
async function lessons() {
  if (LESSONS) return LESSONS;
  try { LESSONS = await (await fetch('./reviewer/lessons.json')).json(); }
  catch (e) { LESSONS = []; }
  saveForOffline();
  return LESSONS;
}
const cache = {};
async function getText(path) {
  if (cache[path] !== undefined) return cache[path];
  const r = await fetch(path); if (!r.ok) throw new Error(r.status);
  return (cache[path] = path.endsWith('.json') ? await r.json() : await r.text());
}
/* Fetch every lesson once in the background so the whole reviewer works with no signal later. */
function saveForOffline() {
  if (!navigator.onLine || st.offlineSaved === LESSONS.length || !('serviceWorker' in navigator)) return;
  const run = async () => {
    for (const l of LESSONS) {
      try { if (l.notes) await fetch(`./reviewer/notes/${l.id}.txt`); if (l.quiz) await fetch(`./reviewer/quiz/${l.id}.json`); } catch (e) { return; }
    }
    st.offlineSaved = LESSONS.length; save();
  };
  if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 5000 }); else setTimeout(run, 2500);
}
const subjectInfo = id => SUBJECTS.find(s => s.id === id) || { id, name: '', courses: 'all' };

/* ---------------- views + routing ---------------- */
/* Course / exam changes: the page itself swaps instantly (no whole-screen fade); only the
   subject cells move, sliding quickly from their old spot to their new one. */
function swap(update) {
  if (!document.startViewTransition || document.hidden) return Promise.resolve(update());
  const t = document.startViewTransition(update);
  return t.updateCallbackDone.catch(() => {});
}
const VIEWS = ['viewChoose', 'viewReview', 'viewSubject', 'viewUpload'];
function show(id) {
  VIEWS.forEach(v => $('#' + v).classList.toggle('hidden', v !== id));
  const onUpload = id === 'viewUpload';
  const sw = $('#switchMode');
  sw.classList.toggle('hidden', id === 'viewChoose');
  sw.href = onUpload ? '#/review' : '#/upload';
  sw.innerHTML = (onUpload ? ICON_BOOK : ICON_UP) + `<span>${onUpload ? 'Review' : 'Upload'}</span>`;
  sw.setAttribute('aria-label', onUpload ? 'Go to the reviewer' : 'Upload your lessons');
  $('#net').classList.toggle('hidden', id !== 'viewUpload');
  $('#backBtn').classList.toggle('hidden', id !== 'viewSubject');
}
async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent).filter(Boolean);
  if (!parts.length) {
    if (st.mode) { location.replace('#/' + st.mode); return; }
    show('viewChoose'); return;
  }
  if (parts[0] === 'upload') { remember('upload'); show('viewUpload'); return; }
  /* fill the page first, then show it, so it never appears half-built */
  if (parts[0] === 'review') { remember('review'); await renderReview(); show('viewReview'); return; }
  if (parts[0] === 's' && parts[1]) { remember('review'); await renderSubject(parts[1], parts[2], parts[3]); show('viewSubject'); return; }
  location.replace('#/');
}
/* the first choice is asked once; after that Hive opens where you last were */
function remember(mode) { if (st.mode !== mode) { st.mode = mode; save(); } }
window.addEventListener('hashchange', async () => { await route(); window.scrollTo(0, 0); });

/* ---------------- review: subjects ---------------- */
const EXAM_ORDER = ['Prelim', 'Midterm', 'Finals'];
const examLabel = e => ({ Prelim: 'Prelims', Midterm: 'Midterms', Finals: 'Finals' }[e] || e);
/* The exam the school is in now: set on the admin page, saved by the upload page. */
function currentExam() {
  try { const e = (JSON.parse(localStorage.getItem('hive.prefs.v1')) || {}).exam; if (EXAM_ORDER.includes(e)) return e; } catch (e) {}
  return CFG.defaultExamPeriod || 'Finals';
}
let examSel = '';   // not saved: every visit opens on the current exam
function scope() {
  const c = st.course !== undefined ? st.course : uploadCourse();
  return COURSES.includes(c) ? c : 'all';
}
const lessonFits = (l, sc, ex) => l.exam === ex && (sc === 'all' || !l.course || l.course === sc);

async function renderReview() {
  const L = await lessons(), sc = scope(), now = currentExam();
  /* tabs: exams that have notes, plus the current one (even when it's still empty) */
  const exams = EXAM_ORDER.filter(e => e === now || L.some(l => l.exam === e));
  if (!exams.includes(examSel)) examSel = now;

  paintCoursePick(sc);
  $('#examTabs').innerHTML = exams.map(e =>
    `<button type="button" role="tab" class="doodle" data-exam="${e}" aria-selected="${e === examSel}">${examLabel(e)}${e === now ? '<i>now</i>' : ''}</button>`).join('');

  const ids = [...new Set([...SUBJECTS.map(s => s.id), ...L.map(l => l.subject)])];
  const visible = ids.map(subjectInfo).filter(s => sc === 'all' || isShared(s) || s.courses.includes(sc));
  /* Subjects are cells in a hive: rows nest into each other's gaps, and the shape is
     mirror-symmetric (same rule as the course picker). Subjects with notes come first;
     ones with nothing yet are empty dashed cells that lead to Upload. */
  const count = s => L.filter(l => l.subject === s.id && lessonFits(l, sc, examSel)).length;
  const list = [...visible.filter(count), ...visible.filter(s => !count(s))];
  const cell = (s, i) => {
    const n = count(s);
    return `<a class="hcell${n ? '' : ' empty'}" style="view-transition-name:hc-${s.id.replace(/[^\w-]/g, '_')}" href="${n ? '#/s/' + encodeURIComponent(s.id) : '#/upload'}"
        aria-label="${esc(s.id + (s.name ? ', ' + s.name : '') + (n ? `, ${n} lessons` : ', no reviewer yet'))}">
        ${window.Doodle ? Doodle.cell(i) : ''}<span class="hc-in"><b class="doodle">${esc(s.id)}</b>${s.name ? `<span>${esc(s.name)}</span>` : ''}</span></a>`;
  };
  const SHAPES = { 1: [1], 2: [2], 3: [2, 1], 4: [1, 2, 1], 5: [3, 2], 6: [2, 3, 1], 7: [2, 3, 2], 8: [3, 2, 3], 9: [2, 3, 2, 2], 10: [3, 2, 3, 2] };
  const rows = SHAPES[list.length] || list.map((_, r) => r % 2 ? 2 : 3);
  let html = '';
  for (let i = 0, r = 0; i < list.length; r++) { const n = rows[r]; html += `<div class="hive-row">${list.slice(i, i + n).map((s, k) => cell(s, i + k)).join('')}</div>`; i += n; }
  $('#subjectGrid').innerHTML = html || '<p class="meta center">No subjects for this course yet.</p>';

  const filled = list.filter(count).length;
  const who = sc === 'all' ? '' : sc + ' ';
  $('#hiveHint').innerHTML = !filled
    ? `<p><b>No ${esc(who + examLabel(examSel))} reviewers yet.</b> Send your ${esc(examLabel(examSel))} lessons and they'll be turned into notes and quizzes.</p>
       <a class="btn" href="#/upload">Upload lessons</a>`
    : filled < list.length ? '<p class="meta">Dashed cells have no notes yet. Tap one to upload lessons for it.</p>'
    : '<p class="meta">Tap a subject to open its notes and quiz.</p>';
}
/* Course picker: one hex. Tap it and the other courses roll out of it into a little honeycomb.
   Cells sit on real hex-grid neighbour spots (left, lower-left, lower-left-left), so the open
   menu is itself a piece of comb. Each cell spins in from the centre, one after another. */
const HEX_D = 48;                                  // centre-to-centre distance of neighbouring cells
/* The current course is the middle cell and stays exactly where the button is. The others spin
   out of it to comb spots on its left and below (the button sits at the screen's right edge):
   left, down-left, down-left-left, then further left if more courses are added. */
const SPOTS = [[-1, 0], [-0.5, 0.866], [-1.5, 0.866], [-2, 0], [-1, 1.732], [-2, 1.732]];
const shortName = c => c === 'all' ? 'All' : c;
function paintCoursePick(sc) {
  const btn = $('#courseBtn');
  btn.innerHTML = (window.Doodle ? Doodle.cell() : '') + `<span>${esc(shortName(sc))}</span>`;
  btn.setAttribute('aria-label', 'Course: ' + (sc === 'all' ? 'Everything' : sc) + '. Change course');
  const opts = ['all', ...COURSES];
  const order = [sc, ...opts.filter(c => c !== sc)];   // the current one is the middle cell
  $('#coursePop').innerHTML = order.map((c, i) => {
    const [x, y] = i ? SPOTS[i - 1] || [-i, 0] : [0, 0];   // everyone else starts inside the middle cell
    return `<button type="button" role="menuitemradio" aria-checked="${c === sc}" data-course="${esc(c)}"
      style="--x:${Math.round(x * HEX_D)}px;--y:${Math.round(y * HEX_D)}px;--i:${i}" aria-label="${c === 'all' ? 'Everything' : esc(c)}" tabindex="-1">
      ${window.Doodle ? Doodle.cell() : ''}<span>${esc(shortName(c))}</span></button>`;
  }).join('');
}
let closeTimer = 0, readyTimer = 0;
function openCourses(on) {
  const box = $('#coursePick');
  if (!on && !box.classList.contains('open')) return;
  clearTimeout(closeTimer); clearTimeout(readyTimer);
  box.classList.remove('ready');
  /* Taps only count once every cell has landed, so a fast double-tap can't pick a course by accident */
  if (on) readyTimer = setTimeout(() => box.classList.add('ready'), 340);
  box.classList.toggle('open', on);
  /* closing floats the cells back in, then they are hidden */
  box.classList.toggle('closing', !on);
  if (!on) closeTimer = setTimeout(() => box.classList.remove('closing', 'picking'), 240);
  $('#courseBtn').setAttribute('aria-expanded', String(on));
  box.querySelectorAll('.ch-pop button').forEach(b => { b.tabIndex = on ? 0 : -1; });
  if (on) setTimeout(() => box.querySelector('.ch-pop button:nth-child(2)')?.focus({ preventScroll: true }), 250);
}
$('#courseBtn').addEventListener('click', e => {
  e.stopPropagation();
  const box = $('#coursePick');
  if (box.classList.contains('open') && !box.classList.contains('ready')) return;   // still spinning out: ignore
  openCourses(!box.classList.contains('open'));
});
$('#coursePop').addEventListener('click', e => {
  const b = e.target.closest('[data-course]'); if (!b) return;
  e.stopPropagation();
  if (!$('#coursePick').classList.contains('ready')) return;   // cells still moving
  const changed = b.dataset.course !== scope();
  st.course = b.dataset.course; save();
  const box = $('#coursePick');
  if (changed) {
    /* the picked cell floats into the middle; once it lands the button takes its place and settles */
    b.classList.add('picked'); box.classList.add('picking');
    setTimeout(() => {
      swap(async () => {
        clearTimeout(closeTimer); box.classList.remove('closing', 'picking');
        paintCoursePick(scope());                        // paint the button now, so the old course never flashes
        box.classList.remove('landed'); void box.offsetWidth; box.classList.add('landed');
        await renderReview();
      });
    }, 230);
  }
  openCourses(false);
  $('#courseBtn').focus({ preventScroll: true });
});
document.addEventListener('click', e => { if (!e.target.closest('#coursePick')) openCourses(false); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#coursePick').classList.contains('open')) { openCourses(false); $('#courseBtn').focus(); }
});
$('#examTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-exam]'); if (!b) return;
  swap(() => { examSel = b.dataset.exam; return renderReview(); });
});

/* ---------------- subject: lessons + Notes | Quiz ---------------- */
/* A plain mouse wheel only scrolls up/down, so over the lesson chips it scrolls them sideways instead. */
$('#lessonRow').addEventListener('wheel', e => {
  const row = e.currentTarget;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || row.scrollWidth <= row.clientWidth) return;
  const max = row.scrollWidth - row.clientWidth;
  if ((e.deltaY < 0 && row.scrollLeft <= 0) || (e.deltaY > 0 && row.scrollLeft >= max)) return; // at an end: let the page scroll
  e.preventDefault();
  row.scrollLeft += e.deltaY;
}, { passive: false });
let cur = { subj: '', lesson: '', tab: 'notes' };
async function renderSubject(subj, lessonId, tab) {
  const all = (await lessons()).filter(l => l.subject === subj), s = subjectInfo(subj);
  const sc = scope(), linked = all.find(l => l.id === lessonId);
  if (linked) examSel = linked.exam;                       // a shared link opens on that lesson's exam
  if (!examSel || !all.some(l => lessonFits(l, sc, examSel))) examSel = (all.find(l => sc === 'all' || l.course === sc) || all[0] || {}).exam || examSel;
  let L = all.filter(l => lessonFits(l, sc, examSel));
  if (!L.length) L = all.filter(l => l.exam === examSel);
  if (!L.length) { location.replace('#/review'); return; }
  const lesson = L.find(l => l.id === lessonId) || L.find(l => l.id === st.last?.[subj]) || L[0];
  tab = tab === 'quiz' ? 'quiz' : 'notes';
  if (lesson.id !== lessonId || tab !== (location.hash.split('/')[4] || '')) {
    history.replaceState(null, '', `#/s/${encodeURIComponent(subj)}/${encodeURIComponent(lesson.id)}/${tab}`);
  }
  st.last = st.last || {}; st.last[subj] = lesson.id; save();
  cur = { subj, lesson: lesson.id, tab };

  $('#subjTitle').textContent = s.id;
  $('#subjName').textContent = [s.name, examLabel(examSel)].filter(Boolean).join(' · ');
  $('#lessonRow').innerHTML = L.map(l => `<a class="lesson-chip${l.id === lesson.id ? ' on' : ''}" href="#/s/${encodeURIComponent(subj)}/${encodeURIComponent(l.id)}/${tab}"
      ${l.id === lesson.id ? 'aria-current="page"' : ''}>${esc(l.tab)}${st.best[l.id] != null ? ` <i>${st.best[l.id]}%</i>` : ''}</a>`).join('');
  $('#lessonRow').querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  $('#lessonTitle').textContent = lesson.title;
  document.querySelectorAll('#tabs [data-tab]').forEach(a => {
    a.href = `#/s/${encodeURIComponent(subj)}/${encodeURIComponent(lesson.id)}/${a.dataset.tab}`;
    a.setAttribute('aria-selected', String(a.dataset.tab === tab));
  });
  const box = $('#lessonBody');
  box.innerHTML = '<p class="meta">Loading…</p>';
  try {
    if (tab === 'notes') box.innerHTML = notesHtml(await getText(`./reviewer/notes/${lesson.id}.txt`), lesson);
    else renderQuiz(await getText(`./reviewer/quiz/${lesson.id}.json`), lesson);
  } catch (e) {
    box.innerHTML = `<p class="meta">${navigator.onLine ? "Couldn't load this lesson." : 'This lesson isn’t saved on your phone yet. Open it once with signal.'}</p>`;
  }
}

/* Notes: plain text with a few markers.
   ★ key point · ⚙ practice · "EASIER:" plain-words explanation · ALL CAPS line = heading */
function kind(t, i) {
  if (!t) return 'sp';
  if (i === 0) return 'skip';                   // first line repeats the lesson title
  if (t[0] === '★') return 'def';
  if (t[0] === '⚙') return 'prac';
  if (/^EASIER:/i.test(t)) return 'easy';
  if ((t.match(/[A-Za-z]/g) || []).length >= 4 && t === t.toUpperCase() && t.length <= 100) return 'h';
  if (/^\d+\.\s/.test(t) && t.length <= 70 && !/[.:;]$/.test(t)) return 'h';
  return 'p';
}
function notesHtml(text, lesson) {
  let h = '', lastSp = true;
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, i) => {
    const t = raw.trim(), k = kind(t, i);
    if (k === 'skip') return;
    if (k === 'sp') { if (!lastSp) h += '<div class="sp"></div>'; lastSp = true; return; }
    lastSp = false;
    if (k === 'h') h += `<h3 class="n-h">${esc(t)}</h3>`;
    else if (k === 'def') h += `<p class="n-def">${esc(t.replace(/^★\s*/, ''))}</p>`;
    else if (k === 'prac') h += `<p class="n-prac">${esc(t.replace(/^⚙\s*/, ''))}</p>`;
    else if (k === 'easy') h += `<p class="n-easy"><b>Easier:</b> ${esc(t.replace(/^EASIER:\s*/i, ''))}</p>`;
    else h += `<p>${esc(t)}</p>`;
  });
  return `<article class="notes">${h}</article>` +
    (lesson.quiz ? `<a class="primary hand doodle btn-block" href="#/s/${encodeURIComponent(lesson.subject)}/${encodeURIComponent(lesson.id)}/quiz">Take the quiz</a>` : '');
}

/* Quiz: one question at a time, answer shows right away with the explanation.
   Progress is kept per lesson, so leaving and coming back continues where you were. */
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function quizState(lesson, qs, fresh) {
  let q = st.quiz[lesson.id];
  if (fresh || !q || q.n !== qs.length) q = st.quiz[lesson.id] = { n: qs.length, order: shuffle(qs.map((_, i) => i)), at: 0, score: 0, picked: null };
  return q;
}
function renderQuiz(qs, lesson, fresh) {
  const box = $('#lessonBody'), q = quizState(lesson, qs, fresh); save();
  if (q.at >= qs.length) {
    const pct = Math.round(q.score / qs.length * 100);
    const best = st.best[lesson.id];
    box.innerHTML = `<div class="quiz-end">
      <p class="doodle big">${q.score} / ${qs.length}</p>
      <p>${pct >= 80 ? 'Great work. You know this lesson.' : pct >= 50 ? 'Not bad. Read the notes once more, then try again.' : 'Read the notes first, then try again.'}</p>
      ${best != null ? `<p class="meta">Your best: ${best}%</p>` : ''}
      <button type="button" class="primary hand doodle" data-q="again">Try again</button>
      <a class="btn" href="#/s/${encodeURIComponent(lesson.subject)}/${encodeURIComponent(lesson.id)}/notes">Back to notes</a></div>`;
    return;
  }
  const item = qs[q.order[q.at]], answered = q.picked != null;
  box.innerHTML = `<div class="quiz">
    <div class="q-top"><span class="meta">Question ${q.at + 1} of ${qs.length}</span><span class="meta">Score ${q.score}</span></div>
    <div class="bar"><i style="width:${q.at / qs.length * 100}%"></i></div>
    <p class="q-text">${esc(item.q)}</p>
    <div class="opts">${item.options.map((o, i) => {
      const cls = !answered ? '' : i === item.answer ? ' right' : i === q.picked ? ' wrong' : ' dim';
      return `<button type="button" class="opt${cls}" data-opt="${i}" ${answered ? 'disabled' : ''}><span class="opt-l">${'ABCDEF'[i]}</span><span>${esc(o)}</span></button>`;
    }).join('')}</div>
    ${answered ? `<div class="explain ${q.picked === item.answer ? 'ok' : 'no'}" role="status"><b>${q.picked === item.answer ? 'Correct!' : 'Not quite.'}</b> ${esc(item.explanation || '')}</div>
      <button type="button" class="primary hand doodle" data-q="next">${q.at + 1 < qs.length ? 'Next question' : 'See my score'}</button>` : ''}
  </div>`;
  if (answered) box.querySelector('[data-q=next]').focus({ preventScroll: true });
}
$('#lessonBody').addEventListener('click', async e => {
  if (cur.tab !== 'quiz') return;
  const L = (await lessons()).find(l => l.id === cur.lesson); if (!L) return;
  const qs = await getText(`./reviewer/quiz/${L.id}.json`), q = st.quiz[L.id];
  const opt = e.target.closest('[data-opt]'), act = e.target.closest('[data-q]')?.dataset.q;
  if (opt && q && q.picked == null) {
    q.picked = +opt.dataset.opt;
    if (q.picked === qs[q.order[q.at]].answer) q.score++;
  } else if (act === 'next') {
    q.at++; q.picked = null;
    if (q.at >= qs.length) {
      const pct = Math.round(q.score / qs.length * 100);
      st.best[L.id] = Math.max(st.best[L.id] ?? 0, pct);
    }
    window.scrollTo({ top: $('#tabs').offsetTop - 8 });
  } else if (act === 'again') { renderQuiz(qs, L, true); return; }
  else return;
  save();
  if (act === 'next' && q.at >= qs.length) renderSubject(cur.subj, cur.lesson, 'quiz'); // also refreshes the best-score chips
  else renderQuiz(qs, L);
});

if (window.Doodle) document.querySelectorAll('[data-bgcomb]').forEach(el => { el.innerHTML = Doodle.comb({ honey: 'none', ink: '#FFC21A', sticker: '' }); });

/* ---------------- first open ---------------- */
$('#viewChoose').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]'); if (!b) return;
  location.hash = '#/' + b.dataset.mode;
});

route();
})();
