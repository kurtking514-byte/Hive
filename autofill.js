/* Hive auto-fill: reads a lesson file ON THE PHONE (no AI, no internet, no limits)
   and guesses the subject, teacher, lesson title and type.
   - PowerPoint / Word (.pptx, .docx): the file's hidden info (title, author)
     plus the text of the first slides / first page.
   - PDF: the file's hidden title and author.
   - Old .ppt / .doc: only the file name.
   Every guess can be edited by the student before sending. */
(function (g) {
'use strict';

const BAD_TITLE = /^(powerpoint presentation|presentation\s*\d*|slide\s*\d+|microsoft (word|powerpoint).*|document\s*\d*|untitled.*|title|click to add (title|text)|pdf|new (document|presentation).*)$/i;
const BAD_AUTHOR = /^(user\s*\d*|admin(istrator)?|owner|windows user|microsoft office user|microsoft|office|pc|hp|asus|acer|lenovo|dell|student|teacher|unknown|author|canva|google|wps( office)?|apple|guest|default|ppt|pptx|docx)$/i;
const SKIP_LINE = /^(university of cebu|uc|college of .*|department of .*|citcs|republic of the philippines|page \d+|\d+|[a-z]{1,2}|(first|second) semester.*|s\.?y\.?\s*\d.*)$/i;
const LESSON = /\b(Lecture|Lesson|Module|Unit|Week|Chapter|Topic|Lab)\s*(?:No\.?\s*|#\s*)?(\d{1,2})\b/i;
const LABEL = /\b(?:Instructor|Teacher|Professor|Lecturer|Faculty|Prepared by|Presented by|Discussed by|Facilitator)\s*[:\-–]\s*([^\n|•·]{3,60})/i;
const HON = /(?:^|[^A-Za-z])((?:[Pp]rof(?:essor)?|PROF|[Dd]r|DR|[Ee]ngr|ENGR|M[rs]|MR|MS|Mrs|MRS|[Aa]tty|ATTY|Sir|SIR|Ma'?am|MA'?AM)\.?)\s+((?:[A-Z][A-Za-z'’-]*\.?)(?:\s+(?:[A-Z][A-Za-z'’-]*\.?|de|dela|del|de la|van)){0,4})/;

const decode = s => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
const tagText = (xml, name) => { const m = xml.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>')); return m ? decode(m[1]).trim() : ''; };
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const titleCase = s => s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (m, a, b) => a + b.toUpperCase()) : s;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Paragraph text out of Office XML: <a:p>…<a:t>text</a:t>…</a:p> (slides) or <w:p>/<w:t> (Word). */
function paragraphs(xml, p, t) {
  const re = new RegExp('<' + t + '(?:\\s[^>]*)?>([^<]*)</' + t + '>', 'g');
  return xml.split('</' + p + '>').map(chunk => { let m, s = ''; while ((m = re.exec(chunk))) s += m[1]; return clean(decode(s)); }).filter(Boolean);
}

async function readOffice(file, ext) {
  if (!g.fflate) return null;
  const want = name => name === 'docProps/core.xml' ||
    (ext === 'pptx' && /^ppt\/slides\/slide[1-3]\.xml$/.test(name)) ||
    (ext === 'docx' && name === 'word/document.xml');
  const files = g.fflate.unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: f => want(f.name) });
  const text = name => files[name] ? g.fflate.strFromU8(files[name]) : '';
  const core = text('docProps/core.xml');
  let lines = [];
  if (ext === 'pptx') {
    Object.keys(files).filter(n => n.startsWith('ppt/slides/')).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))
      .forEach(n => { lines = lines.concat(paragraphs(text(n), 'a:p', 'a:t')); });
  } else {
    lines = paragraphs(text('word/document.xml'), 'w:p', 'w:t').slice(0, 60);
  }
  return { title: tagText(core, 'dc:title'), author: tagText(core, 'dc:creator'), lines };
}

/* PDF: the Info dictionary (/Title, /Author) or the XMP block. Text inside pages is compressed, so we skip it. */
async function readPdf(file) {
  const MB = 1024 * 1024;
  const latin = buf => new TextDecoder('latin1').decode(buf);
  let txt = latin(await file.slice(0, Math.min(file.size, 1.5 * MB)).arrayBuffer());
  if (file.size > 1.5 * MB) txt += latin(await file.slice(file.size - 256 * 1024).arrayBuffer());
  const utf8 = s => { try { return decodeURIComponent(escape(s)); } catch (e) { return s; } };
  const utf16 = bytes => { let s = ''; for (let i = 2; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] << 8 | bytes[i + 1]); return s; };
  const pdfString = raw => {
    if (raw[0] === '<') {
      const hex = raw.slice(1, -1).replace(/\s/g, ''); const b = [];
      for (let i = 0; i + 1 < hex.length; i += 2) b.push(parseInt(hex.substr(i, 2), 16));
      return b[0] === 0xFE && b[1] === 0xFF ? utf16(b) : String.fromCharCode(...b);
    }
    const s = raw.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (m, c) =>
      /\d/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ({ n: '\n', r: '\r', t: '\t', b: '', f: '' }[c] ?? c));
    return s.charCodeAt(0) === 0xFE && s.charCodeAt(1) === 0xFF ? utf16([...s].map(c => c.charCodeAt(0))) : s;
  };
  const info = key => { const m = txt.match(new RegExp('/' + key + '\\s*(\\((?:\\\\.|[^\\\\)])*\\)|<[0-9A-Fa-f\\s]*>)')); return m ? clean(pdfString(m[1])) : ''; };
  const xmp = key => { const m = txt.match(new RegExp('<dc:' + key + '>[\\s\\S]*?<rdf:li[^>]*>([\\s\\S]*?)</rdf:li>')); return m ? clean(decode(utf8(m[1]))) : ''; };
  return { title: xmp('title') || info('Title'), author: xmp('creator') || info('Author'), lines: [] };
}

function findSubject(hay, subjects) {
  let best = null, bestScore = 0, bestPos = Infinity;
  for (const s of subjects || []) {
    const idRe = new RegExp('(?:^|[^A-Za-z0-9])' + esc(s.id).replace(/(\d+)$/, '[\\s-]*$1') + '(?![0-9])', 'i');
    const nameRe = s.name ? new RegExp(s.name.split(/[\s-]+/).map(esc).join('[\\s\\-–]+'), 'i') : null;
    const a = hay.search(idRe), b = nameRe ? hay.search(nameRe) : -1;
    const score = (a >= 0 ? 3 : 0) + (b >= 0 ? 2 : 0);
    const pos = Math.min(a >= 0 ? a : Infinity, b >= 0 ? b : Infinity);
    if (score > bestScore || (score === bestScore && score > 0 && pos < bestPos)) { best = s; bestScore = score; bestPos = pos; }
  }
  return best;
}

/* Drop degrees and titles after a comma: "Engr. Ramon Reyes, MSc" -> "Engr. Ramon Reyes". */
const noDegree = s => s.split(',')[0].replace(/[;.\s]+$/, '').trim();

function findTeacher(lines, author) {
  for (const l of lines) { const m = l.match(LABEL); if (m) return noDegree(titleCase(clean(m[1]))).slice(0, 60); }
  for (const l of lines) {
    const m = l.match(HON);
    if (m) {
      const hon = m[1].replace(/^(PROF|DR|ENGR|MR|MS|MRS|ATTY|SIR|MA'?AM)/, x => x[0] + x.slice(1).toLowerCase());
      return noDegree(hon + ' ' + titleCase(clean(m[2]))).slice(0, 60);
    }
  }
  const a = clean(author);
  if (a && !BAD_AUTHOR.test(a) && /^[A-Za-z][A-Za-z .,'-]{2,58}$/.test(a)) return noDegree(titleCase(a));
  return '';
}

function typeOf(ext, hay) {
  if (/\b(activity|exercise|worksheet|laboratory|lab \d)\b/i.test(hay)) return 'Activity / exercise';
  if (ext === 'pptx' || ext === 'ppt') return 'Lecture slides';
  if (/\bmodule\b/i.test(hay)) return 'Lesson / module';
  return 'Handout / notes';
}

function analyse(info, subjects, fileName, ext) {
  info = info || { title: '', author: '', lines: [] };
  const fname = clean(fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s*-\s*/g, ' - '));
  const lines = (info.lines || []).slice(0, 80);
  const hay = [info.title, ...lines, fname].filter(Boolean).join('\n');

  const subject = findSubject(hay, subjects);
  const teacher = findTeacher(lines, info.author);
  const isTeacherLine = l => LABEL.test(l) || HON.test(l);
  const isSubjectLine = l => !!subject && findSubject(l, [subject]) && l.length <= subject.id.length + (subject.name || '').length + 12;
  const afterTag = l => l.replace(LESSON, '').replace(/^[\s:–—.-]+/, '').trim();
  const okTitle = t => t && t.length >= 3 && t.length <= 150 && !BAD_TITLE.test(t) && !/^[\d\s._-]+$/.test(t);
  const usable = l => okTitle(l) && l.length <= 120 && !SKIP_LINE.test(l) && !isTeacherLine(l) && !isSubjectLine(l);

  /* Best title, in order: a "Lecture 3: Topic" line, the file's own title, the first real line, the file name. */
  /* "CC7 Lecture 3: Topic" -> "Lecture 3: Topic" (the subject is already its own chip). */
  const dropSubject = l => subject ? l.replace(new RegExp('^\\s*' + esc(subject.id).replace(/(\d+)$/, '[\\s-]*$1') + '(?![0-9])[\\s:–—|.-]*', 'i'), '') : l;
  const fileTitle = dropSubject(clean(info.title));
  const lessonLine = [fileTitle, ...lines.map(dropSubject)].find(l => LESSON.test(l) && afterTag(l).length >= 3 && l.length <= 120);
  let title = lessonLine
    || (usable(fileTitle) ? fileTitle : '')
    || lines.find(l => usable(l) && !(LESSON.test(l) && afterTag(l).length < 3))
    || fname;
  const lm = hay.match(LESSON);
  if (lm) {
    const tag = lm[1][0].toUpperCase() + lm[1].slice(1).toLowerCase() + ' ' + lm[2];
    if (!new RegExp('\\b' + esc(lm[1]) + '\\s*(?:No\\.?\\s*|#\\s*)?' + lm[2] + '\\b', 'i').test(title)) title = tag + ': ' + title;
  }
  return {
    subject: subject ? subject.id : '',
    teacher,
    title: title.slice(0, 150),
    type: typeOf(ext, hay),
    found: { subject: !!subject, teacher: !!teacher, title: title !== fname }
  };
}

async function read(file, subjects) {
  const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, ''])[1].toLowerCase();
  let info = null;
  try {
    if (ext === 'pptx' || ext === 'docx') info = await readOffice(file, ext);
    else if (ext === 'pdf') info = await readPdf(file);
  } catch (e) { info = null; }
  return analyse(info, subjects, file.name, ext);
}

const api = { read, analyse };
g.HiveAutofill = api;
if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
