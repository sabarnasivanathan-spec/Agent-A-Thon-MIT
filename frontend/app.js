"use strict";
/* StudySync AI — runs fully in the browser. Data is saved in this browser only (localStorage). */
const $app = document.getElementById("app");
const KEY = "studysync_v2";
let db = loadDB();
const ui = { page: "dashboard", err: "", authTab: "login", draft: {}, analyzing: null, active: null, hist: "all", recovery: null, recoveryLoading: false, aiTab: "notes", notesTopic: null, notesCache: {}, notesLoading: false, pyqSubject: null, pyqResult: null, pyqLoading: false, chat: [] };

/* ---------- storage & helpers ---------- */
function loadDB() { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.users) return d; } catch (e) {} return { users: {}, current: null }; }
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast("Browser storage is full — remove some large files."); } }
const user = () => db.users[db.current];
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const today = () => ymd(new Date());
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const daysBetween = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 864e5);
const fmtDate = s => parseYmd(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtTime = m => { const h = Math.floor(m / 60) % 24, mm = m % 60; return `${(h % 12) || 12}:${pad(mm)} ${h < 12 ? "AM" : "PM"}`; };
const fmtDur = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`;
const clock = sec => `${pad(Math.floor(sec / 60))}:${pad(Math.floor(sec % 60))}`;
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const bar = n => `<div class="progress"><span style="width:${Math.max(0, Math.min(100, n))}%"></span></div>`;
function toast(m) { const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2800); }
function hash(s) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) | 0; return String(h); }
function log(kind, o) { user().history.unshift({ id: uid(), ts: Date.now(), kind, ...o }); }

/* ---------- text analysis (topic extraction, notes, flashcards, tests) ---------- */
const STOP = new Set("the and for that with this from are was were have has had not but you your they their them which will would can could should about into than then there these those what when where who whom whose how why also such other more most some any each per via its our out use used using may might been being between over under after before because while during within without very just only both either neither".split(" "));
const words = t => (t.toLowerCase().match(/[a-z][a-z'-]{3,}/g) || []).filter(w => !STOP.has(w));
function topWords(t, n) { const c = {}; words(t).forEach(w => c[w] = (c[w] || 0) + 1); return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]); }
const sentences = t => t.replace(/\r/g, "").split(/(?<=[.!?])\s+|\n+/).map(s => s.replace(/^[\s\-*•\d.)#]+/, "").trim()).filter(s => s.length >= 25 && s.length <= 280);
const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

function headingOf(line) {
  const l = line.trim(); if (!l || l.length > 80) return null; let m;
  if ((m = l.match(/^#{1,4}\s+(.+)$/))) return m[1].trim();
  if ((m = l.match(/^(?:chapter|unit|module|topic|lesson|section|week)\s*[\dIVXivx]+\s*[:.\-–—]?\s*(.*)$/i))) return (m[1] || l).trim() || l;
  if ((m = l.match(/^\d+(?:\.\d+)*[.)]?\s+([A-Z][^.!?]{2,70})$/))) return m[1].trim();
  if (/^[A-Z0-9][A-Z0-9 &,:'()\/-]{3,60}$/.test(l) && /[A-Z]{3}/.test(l)) return titleCase(l);
  if (/^[A-Z][^.!?]{2,60}:$/.test(l)) return l.slice(0, -1);
  return null;
}
function extractTopics(text, subjectId) {
  text = (text || "").replace(/\r/g, ""); if (text.trim().length < 30) return [];
  const lines = text.split("\n"), heads = [];
  lines.forEach((l, i) => { const h = headingOf(l); if (h) heads.push({ i, h }); });
  let out = [];
  if (heads.length >= 2) {
    heads.forEach((h, k) => { const body = lines.slice(h.i + 1, k + 1 < heads.length ? heads[k + 1].i : lines.length).join("\n").trim(); out.push({ title: h.h, text: body }); });
  } else {
    const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    const size = Math.max(1000, text.length / 15); let cur = "";
    const flush = () => { if (cur.trim()) out.push({ title: "Key ideas: " + topWords(cur, 3).map(cap).join(", "), text: cur.trim() }); cur = ""; };
    paras.forEach(p => { cur += p + "\n\n"; if (cur.length >= size) flush(); }); flush();
  }
  return out.slice(0, 25).map(t => ({ id: uid(), subjectId, title: t.title.slice(0, 90), text: t.text.slice(0, 20000), difficult: false }));
}
function notesFor(t) {
  const ss = sentences(t.text); if (!ss.length) return { points: [], terms: [] };
  const kw = topWords(t.text, 30);
  const score = s => { const w = new Set(words(s)); return kw.reduce((a, k, i) => a + (w.has(k) ? 30 - i : 0), 0) / Math.sqrt(s.length); };
  const pick = ss.map((s, i) => ({ s, i, sc: score(s) })).sort((a, b) => b.sc - a.sc).slice(0, 12).sort((a, b) => a.i - b.i);
  return { points: pick.map(x => x.s), terms: kw.slice(0, 8) };
}
function clozeItems(t) {
  const kw = topWords(t.text, 25).filter(w => w.length >= 5), used = {}, out = [];
  for (const s of sentences(t.text)) {
    const lw = s.toLowerCase(), k = kw.find(k => (used[k] || 0) < 2 && new RegExp("\\b" + k + "\\b").test(lw));
    if (k) { used[k] = (used[k] || 0) + 1; out.push({ s, k }); }
  }
  return out;
}
const blank = (s, k) => s.replace(new RegExp("\\b" + k + "\\b", "i"), "_____");
function cardsFor(t) {
  const cards = [];
  for (const s of sentences(t.text)) {
    const m = s.match(/^(.{3,60}?)\s+(is|are|means|refers to|is defined as|can be defined as)\s+(.{10,})$/i);
    if (m && cards.length < 5) cards.push({ q: /means/i.test(m[2]) ? `What does “${m[1]}” mean?` : `What ${/^are$/i.test(m[2]) ? "are" : "is"} ${m[1].replace(/^(An?|The)\s/, x => x.toLowerCase())}?`, a: s });
  }
  for (const c of shuffle(clozeItems(t))) { if (cards.length >= 8) break; if (!cards.some(x => x.a === c.s)) cards.push({ q: blank(c.s, c.k), a: c.k + " — " + c.s }); }
  if (!cards.length) return [
    { q: `Explain “${t.title}” in your own words.`, a: "Check your notes or textbook, then note anything you missed." },
    { q: `List 3 key points about “${t.title}”.`, a: "Compare with your material and fix gaps." },
    { q: `Give one example or application of “${t.title}”.`, a: "Check it against your material." }];
  return cards;
}
function fullNotesFor(t) {
  const ss = sentences(t.text);
  if (!ss.length) return { overview: "", points: [], terms: [] };
  const kw = topWords(t.text, 40);
  const score = s => { const w = new Set(words(s)); return kw.reduce((a, k, i) => a + (w.has(k) ? 40 - i : 0), 0) / Math.sqrt(s.length); };
  const ranked = ss.map((s, i) => ({ s, i, sc: score(s) })).sort((a, b) => b.sc - a.sc);
  const overview = ranked.slice(0, 3).sort((a, b) => a.i - b.i).map(x => x.s).join(" ");
  const points = ranked.slice(0, 14).sort((a, b) => a.i - b.i).map(x => x.s);
  const terms = kw.slice(0, 10).map(term => ({ term: cap(term), def: ss.find(s => new RegExp("\\b" + term + "\\b", "i").test(s)) || "" })).filter(x => x.def);
  return { overview, points, terms };
}
function answerQuestion(u, q) {
  const qw = words(q);
  if (!qw.length) return { text: "Ask me something about your subjects — e.g. “Explain binary search trees” or “Notes on Newton's laws”.", topic: null };
  let best = null, bestScore = 0;
  u.topics.forEach(t => {
    const tw = new Set(words(t.title + " " + t.text.slice(0, 6000)));
    const score = qw.filter(w => tw.has(w)).length + (qw.some(w => t.title.toLowerCase().includes(w)) ? 3 : 0);
    if (score > bestScore) { bestScore = score; best = t; }
  });
  if (!best || bestScore < 1) return { text: "I couldn't find that in your uploaded materials yet. Try uploading more notes for this subject, or ask about a topic already added.", topic: null };
  const ss = sentences(best.text);
  const picked = ss.map(s => ({ s, sc: words(s).filter(w => qw.includes(w)).length })).sort((a, b) => b.sc - a.sc).slice(0, 4).filter(x => x.sc > 0).map(x => x.s);
  const text = picked.length ? picked.join(" ") : `I found "${best.title}" as the closest match, but couldn't pull a specific answer from the text — try opening its notes instead.`;
  return { text, topic: best };
}
function questionsFor(t, all) {
  const pool = [...new Set([...t.text ? topWords(t.text, 25) : [], ...all.filter(x => x.subjectId === t.subjectId && x.id !== t.id).flatMap(x => topWords(x.text, 10))])].filter(w => w.length >= 5);
  return shuffle(clozeItems(t)).slice(0, 5).map(c => {
    const d = shuffle(pool.filter(w => !w.startsWith(c.k) && !c.k.startsWith(w))).slice(0, 3);
    if (d.length < 1) return null;
    return { q: blank(c.s, c.k), options: shuffle([c.k, ...d]), answer: c.k };
  }).filter(Boolean);
}

function extractQuestions(text) {
  const lines = (text || "").replace(/\r/g, "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const l of lines) {
    const m = l.match(/^(?:q(?:uestion)?\.?\s*\d+\s*[.):]?|\(?[a-z]\)|\d+\s*[.):])\s*(.+)$/i);
    const body = (m ? m[1] : l).trim();
    const looksLikeQ = /\?\s*$/.test(body) || /^(what|why|how|explain|describe|define|differentiate|discuss|list|state|derive|prove|write|compare|illustrate|outline|justify|analyze|analyse|mention|elaborate|summari[sz]e)\b/i.test(body);
    if (looksLikeQ && body.length >= 8 && body.length <= 220) out.push(body.replace(/\s+/g, " "));
  }
  return [...new Set(out)].slice(0, 80);
}
function attachPYQ(sub, list) {
  sub.unmatchedPYQ = [];
  const texts = [...(sub.pyqFiles || []).filter(f => f.status === "ok").map(f => f.text), sub.pyqPaste || ""].filter(t => t && t.trim());
  if (!texts.length) return;
  const hits = {};
  texts.forEach(txt => {
    extractQuestions(txt).forEach(q => {
      const qw = words(q);
      if (!qw.length) return;
      let best = null, bestScore = 0;
      list.forEach(t => {
        const tw = new Set(words(t.title + " " + t.text.slice(0, 4000)));
        const score = qw.filter(w => tw.has(w)).length;
        if (score > bestScore) { bestScore = score; best = t; }
      });
      if (best && bestScore >= 2) {
        hits[best.id] = (hits[best.id] || 0) + 1;
        best.pyqQuestions = best.pyqQuestions || [];
        if (best.pyqQuestions.length < 8 && !best.pyqQuestions.includes(q)) best.pyqQuestions.push(q);
      } else if (!sub.unmatchedPYQ.includes(q)) sub.unmatchedPYQ.push(q);
    });
  });
  Object.entries(hits).forEach(([id, count]) => { const t = list.find(x => x.id === id); if (t) { t.pyqCount = count; t.important = true; } });
  sub.unmatchedPYQ = sub.unmatchedPYQ.slice(0, 30);
}
// Standalone, on-demand PYQ analysis for a single subject — works even before an exam/plan exists.
// Reuses already-extracted topics if present, otherwise extracts topics from the subject's own
// material first (kept local to this call, then merged into u.topics so they show up everywhere).
function mockAnalyzePapers(sub) {
  const u = user();
  let list = u.topics.filter(t => t.subjectId === sub.id);
  const usingExisting = list.length > 0;
  if (!usingExisting) {
    const texts = [...sub.files.filter(f => f.status === "ok").map(f => f.text), sub.paste || ""].filter(t => t.trim());
    const tmp = [];
    texts.forEach(t => extractTopics(t, sub.id).forEach(x => { if (!tmp.some(y => y.title.toLowerCase() === x.title.toLowerCase())) tmp.push(x); }));
    list = tmp;
  }
  attachPYQ(sub, list);
  if (!usingExisting) list.forEach(t => { if (!u.topics.some(x => x.id === t.id)) u.topics.push(t); });
  save();
  return { subjectId: sub.id, topics: list.filter(t => t.important), unmatched: sub.unmatchedPYQ || [] };
}

/* ---------- reading uploaded files ---------- */
async function readFile(file) {
  const ext = (file.name.split(".").pop() || "").toLowerCase(); let text = "", status = "ok";
  try {
    if (["txt", "md", "csv", "json", "html", "htm", "rtf"].includes(ext)) text = await file.text();
    else if (ext === "pdf" && window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      for (let p = 1; p <= Math.min(pdf.numPages, 80); p++) {
        const c = await (await pdf.getPage(p)).getTextContent(); let last = null, line = "";
        for (const it of c.items) { if (last !== null && Math.abs(it.transform[5] - last) > 2) { text += line.trim() + "\n"; line = ""; } line += it.str + " "; last = it.transform[5]; }
        text += line.trim() + "\n\n";
      }
    } else if (ext === "docx" && window.mammoth) text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    else status = "unsupported";
  } catch (e) { status = "error"; }
  if (status === "ok" && text.trim().length < 30) status = "empty";
  return { id: uid(), name: file.name, size: file.size, text: text.slice(0, 300000), status };
}
const subjectsRef = () => (db.current && user().profile) ? user().profile.subjects : ui.draft.subjects;
async function handleFiles(subId, files, field = "files") {
  const sub = subjectsRef().find(s => s.id === subId); if (!sub || !files.length) return;
  if (!sub[field]) sub[field] = [];
  toast(field === "pyqFiles" ? "Reading question papers…" : "Reading files…");
  for (const f of files) sub[field].push(await readFile(f));
  if (db.current) save(); render();
  const bad = sub[field].filter(f => f.status !== "ok").length;
  if (bad) toast("Some files couldn't be read as text (PDF/Word need internet). You can paste the text instead.");
}
const statusBadge = f => f.status === "ok" ? `<span class="badge b-green">Read</span>` : `<span class="badge b-red">${f.status === "unsupported" ? "Unsupported" : "No text found"}</span>`;

/* ---------- topics from materials ---------- */
function tokens(s) { return (s || "").split(/[,;\n]/).map(x => x.trim().toLowerCase()).filter(x => x.length >= 3); }
function analyze(u) {
  const ex = u.exam, topics = [];
  for (const sub of u.profile.subjects.filter(s => ex.subjectIds.includes(s.id))) {
    const texts = [...sub.files.filter(f => f.status === "ok").map(f => f.text), sub.paste || ""].filter(t => t.trim());
    const list = []; texts.forEach(t => extractTopics(t, sub.id).forEach(x => { if (!list.some(y => y.title.toLowerCase() === x.title.toLowerCase())) list.push(x); }));
    for (const tok of tokens(ex.difficult[sub.id])) {
      let m = list.filter(t => { const tl = t.title.toLowerCase(); return tl.includes(tok) || tok.includes(tl) || words(tok).some(w => words(tl).includes(w)); });
      if (!m.length) m = list.map(t => ({ t, n: (t.text.toLowerCase().split(tok).length - 1) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 2).map(x => x.t);
      if (m.length) m.forEach(t => t.difficult = true);
      else list.push({ id: uid(), subjectId: sub.id, title: cap(tok), text: "", difficult: true, manual: true });
    }
    attachPYQ(sub, list);
    topics.push(...list);
  }
  return topics;
}

/* ---------- planning ---------- */
function studyDays(examDate, off) {
  const all = []; for (let d = today(); d < examDate; d = addDays(d, 1)) all.push(d);
  const f = all.filter(d => !off.includes(parseYmd(d).getDay())); return f.length ? f : all;
}
function place(list, days, perDay, startMin, existing, gap = 10) {
  const left = [], used = {}, cur = {}; let di = 0;
  existing.forEach(s => { if (!s.date) return; used[s.date] = (used[s.date] || 0) + s.minutes; cur[s.date] = Math.max(cur[s.date] || startMin, s.start + s.minutes + gap); });
  for (const s of list) {
    while (di < days.length && (used[days[di]] || 0) + s.minutes > perDay && (used[days[di]] || 0) > 0) di++;
    if (di >= days.length) { left.push(s); continue; }
    const d = days[di]; s.date = d; s.start = cur[d] ?? startMin; used[d] = (used[d] || 0) + s.minutes; cur[d] = s.start + s.minutes + gap;
  }
  return left;
}
function buildPlan(u, p) {
  const days = studyDays(u.exam.date, p.offDays), perDay = Math.round(p.hours * 60), T = u.topics;
  if (!days.length || !T.length) return { sessions: [], left: 0, days: days.length };
  const W = t => (1 + Math.min(t.text.length / 2500, 1.5)) * (t.difficult ? 1.7 : 1) * (t.important ? 1.4 : 1) * (p.mult[t.id] || 1);
  const half = Math.max(15, Math.round(p.blockLen / 2 / 5) * 5), total = days.length * Math.max(1, Math.floor(perDay / p.blockLen));
  const revCount = Math.min(T.length * 2, Math.ceil(total * p.revShare));
  const studyBlocks = Math.max(T.length, Math.floor((days.length * perDay - revCount * half) / p.blockLen)), sumW = T.reduce((a, t) => a + W(t), 0);
  const perSub = {}; T.slice().sort((a, b) => (b.difficult - a.difficult)).forEach(t => (perSub[t.subjectId] = perSub[t.subjectId] || []).push(t));
  const queues = Object.values(perSub), order = [];
  while (queues.some(q => q.length)) queues.forEach(q => { if (q.length) order.push(q.shift()); });
  const list = [];
  order.forEach(t => { const n = Math.min(4, Math.max(1, Math.round(W(t) / sumW * studyBlocks))); for (let i = 0; i < n; i++) list.push({ id: uid(), topicId: t.id, subjectId: t.subjectId, type: "study", minutes: p.blockLen, status: "pending" }); });
  const revOrder = [...T.filter(t => t.difficult), ...T.filter(t => !t.difficult)];
  for (let i = 0; i < revCount; i++) { const t = revOrder[i % revOrder.length]; list.push({ id: uid(), topicId: t.id, subjectId: t.subjectId, type: "revision", minutes: half, status: "pending" }); }
  const need = list.reduce((a, s) => a + s.minutes, 0), target = Math.min(perDay, Math.max(p.blockLen, Math.ceil(need / days.length / 5) * 5));
  let left = place(list, days, target, p.startMin, []);
  if (left.length) left = place(left, days, perDay, p.startMin, list.filter(s => s.date));
  return { sessions: list.filter(s => s.date), left: left.length, leftMin: left.reduce((a, s) => a + s.minutes, 0), days: days.length };
}
function newParams(ex) { return { hours: ex.hours, startMin: ex.startMin, blockLen: 45, offDays: [], mult: {}, revShare: 0.15 }; }
function createPlan(u) {
  const params = newParams(u.exam), r = buildPlan(u, params);
  u.plan = { status: "draft", params, sessions: r.sessions, left: r.left, leftMin: r.leftMin || 0, revisions: [], applied: [], unapplied: [], created: Date.now() };
}

/* understand the student's suggestions in plain English */
const DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
function reviseFromText(u, text) {
  const p = u.plan.params, applied = [], unapplied = [];
  const subs = u.profile.subjects;
  for (const raw of text.split(/[.;\n]+/).map(x => x.trim()).filter(Boolean)) {
    const c = raw.toLowerCase(); let did = false;
    const hm = c.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
    if (hm && /(day|daily|study|per|only|limit|increase|reduce|can)/.test(c) && !/session|block/.test(c)) { p.hours = Math.min(12, Math.max(0.5, parseFloat(hm[1]))); applied.push(`Daily study time set to ${p.hours} hour(s)`); did = true; }
    const neg = /\b(no|skip|not|off|except|avoid|rest|free|without|leave)\b/.test(c);
    const wd = Object.keys(DAYS).filter(d => c.includes(d)); const wk = /weekend/.test(c);
    if (neg && (wd.length || wk)) { const set = wk ? [0, 6] : wd.map(d => DAYS[d]); set.forEach(x => { if (!p.offDays.includes(x)) p.offDays.push(x); }); applied.push(`No study on ${wk ? "weekends" : wd.map(cap).join(", ")}`); did = true; }
    const tm = c.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
    if (tm) { let h = +tm[1] % 12; if (tm[3] === "pm") h += 12; p.startMin = h * 60 + (+tm[2] || 0); applied.push(`Start time moved to ${fmtTime(p.startMin)}`); did = true; }
    else { const per = { morning: 7 * 60, afternoon: 14 * 60, evening: 18 * 60, night: 21 * 60 }; const k = Object.keys(per).find(k => c.includes(k)); if (k && /(start|study|schedule|move|prefer|shift|begin|in the)/.test(c)) { p.startMin = per[k]; applied.push(`Start time moved to ${fmtTime(p.startMin)} (${k})`); did = true; } }
    const lm = c.match(/(\d+)\s*(?:min|minute)/);
    if (/(session|block|slot|shorter|longer|break)/.test(c) && (lm || /shorter|longer/.test(c))) { p.blockLen = lm ? Math.min(90, Math.max(20, +lm[1])) : /shorter/.test(c) ? 30 : 60; applied.push(`Session length set to ${p.blockLen} minutes`); did = true; }
    const more = /(more|extra|additional|increase|focus|spend|prioriti[sz]e)/.test(c), less = /(less|reduce|fewer|skip|already know|easy|comfortable|know well)/.test(c);
    if (/revis/.test(c) && (more || less)) { p.revShare = more ? 0.3 : 0.08; applied.push(more ? "More revision time" : "Less revision time"); did = true; }
    else if (more || less) {
      const hit = u.topics.filter(t => c.includes(t.title.toLowerCase()) || words(t.title).some(w => w.length >= 4 && c.includes(w)));
      const subHit = subs.filter(s => c.includes(s.name.toLowerCase()));
      const ids = new Set(hit.map(t => t.id)); if (!hit.length) subHit.forEach(s => u.topics.filter(t => t.subjectId === s.id).forEach(t => ids.add(t.id)));
      if (ids.size) { ids.forEach(id => p.mult[id] = (p.mult[id] || 1) * (more && !less ? 1.7 : 0.55)); applied.push(`${more && !less ? "More" : "Less"} time on ${[...ids].map(id => u.topics.find(t => t.id === id).title).slice(0, 3).join("; ")}${ids.size > 3 ? "…" : ""}`); did = true; }
    }
    if (!did) unapplied.push(raw);
  }
  const r = buildPlan(u, p);
  Object.assign(u.plan, { sessions: r.sessions, left: r.left, leftMin: r.leftMin || 0, applied, unapplied });
  u.plan.revisions.push(text);
}

/* ---------- plan state helpers ---------- */
const topicOf = id => user().topics.find(t => t.id === id);
const subName = id => (user().profile.subjects.find(s => s.id === id) || { name: "Subject" }).name;
const sessOf = id => user().plan.sessions.find(s => s.id === id);
const planApproved = () => user().plan && user().plan.status === "approved";
function markMissed() {
  const u = user(); if (!planApproved()) return; let ch = false;
  u.plan.sessions.forEach(s => { if (s.status === "pending" && s.date && s.date < today()) { s.status = "missed"; ch = true; const t = topicOf(s.topicId); log("missed", { subject: subName(s.subjectId), topic: t ? t.title : "", planned: s.date, text: "Missed session" }); } });
  if (ch) save();
}
function stats() {
  const u = user(), S = u.plan ? u.plan.sessions : [];
  const tot = S.reduce((a, s) => a + s.minutes, 0), done = S.filter(s => s.status === "done").reduce((a, s) => a + s.minutes, 0);
  const studied = S.filter(s => s.status === "done").reduce((a, s) => a + (s.actual || s.minutes), 0);
  const avg = k => { const l = u.history.filter(h => h.kind === k && h.total); return l.length ? Math.round(l.reduce((a, h) => a + h.score / h.total * 100, 0) / l.length) : null; };
  return { pct: tot ? Math.round(done / tot * 100) : 0, studied, doneN: S.filter(s => s.status === "done").length, totalN: S.length, missed: S.filter(s => ["missed", "unscheduled"].includes(s.status)), recall: avg("recall"), test: avg("test") };
}
function makeRecovery(extra) {
  const u = user(), p = u.plan.params, days = studyDays(u.exam.date, p.offDays);
  const weight = s => { const t = topicOf(s.topicId); return (s.status !== "pending" ? 2 : 0) + (t && t.important ? 1 : 0) + (t && t.difficult ? 1 : 0); };
  const todo = u.plan.sessions.filter(s => s.status !== "done").sort((a, b) => weight(b) - weight(a) || (a.date || "z").localeCompare(b.date || "z"));
  const copies = todo.map(s => ({ ...s, date: null, status: "pending", wasMissed: s.status !== "pending" }));
  const done = u.plan.sessions.filter(s => s.status === "done" && s.date >= today());
  const left = place(copies, days, Math.round(p.hours * 60) + extra, p.startMin, done);
  return { extra, placed: copies.filter(s => s.date), left };
}
function addRevision(t) {
  const u = user(), p = u.plan.params, days = studyDays(u.exam.date, p.offDays);
  const s = { id: uid(), topicId: t.id, subjectId: t.subjectId, type: "revision", minutes: 30, status: "pending" };
  const left = place([s], days, Math.round(p.hours * 60) + 30, p.startMin, u.plan.sessions.filter(x => x.date && x.status !== "missed"));
  if (!left.length) { u.plan.sessions.push(s); return true; } return false;
}

/* ============================================================
   AI SERVICE LAYER — 3 AI-powered features
   Every call site in this app talks to the AI object below and
   awaits a Promise, exactly as it would if these hit a real API.
   Today AI_CONFIG.useBackend is false, so each method runs local
   rule-based logic (mock AI) after a short simulated delay.
   To go live: point AI_CONFIG.baseUrl at your backend, flip
   useBackend to true, and implement the three routes below with
   the same request/response shape already wired here. If the
   backend call throws (offline, down, etc.) each method falls
   back to the local mock so a demo never breaks.
   ============================================================ */
const AI_CONFIG = { useBackend: false, baseUrl: "" };
function wait(ms) { return new Promise(res => setTimeout(res, ms)); }
async function callBackend(path, payload) {
  const res = await fetch(AI_CONFIG.baseUrl + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error("AI backend error " + res.status);
  return await res.json();
}
const AI = {
  // 1) AI NOTES GENERATOR — uploaded textbook material -> { overview, points[], terms[] }
  async generateNotes(topic) {
    if (AI_CONFIG.useBackend) {
      try { return await callBackend("/ai/notes", { title: topic.title, text: topic.text }); }
      catch (e) { toast("AI backend unreachable — showing offline-generated notes."); }
    }
    await wait(500); // simulated "thinking" delay
    return fullNotesFor(topic);
  },
  // 2) AI BACKLOG RESCHEDULER — backlog + timetable -> { extra, placed[], left[] } new schedule
  async rescheduleBacklog(extraMinutesPerDay) {
    if (AI_CONFIG.useBackend) {
      try { return await callBackend("/ai/reschedule", { extraMinutesPerDay, plan: user().plan, exam: user().exam }); }
      catch (e) { toast("AI backend unreachable — showing offline-generated schedule."); }
    }
    await wait(600);
    return makeRecovery(extraMinutesPerDay);
  },
  // 3) PREVIOUS-YEAR QUESTION ANALYZER — uploaded papers -> { topics[], unmatched[] } important/repeated topics
  async analyzePapers(sub) {
    if (AI_CONFIG.useBackend) {
      try {
        const papers = [...(sub.pyqFiles || []).filter(f => f.status === "ok").map(f => f.text), sub.pyqPaste || ""].filter(t => t.trim());
        return await callBackend("/ai/pyq", { subjectId: sub.id, papers });
      } catch (e) { toast("AI backend unreachable — showing offline analysis."); }
    }
    await wait(500);
    return mockAnalyzePapers(sub);
  }
};

/* ---------- views ---------- */
function render() { renderApp(); Chat.sync(); }
const logo = () => `<div class="logo"><div class="logo-mark">S</div><span class="logo-text">StudySync AI</span></div>`;
const D = (k, def = "") => ui.draft[k] ?? def;

function renderApp() {
  if (!db.current || !user()) return renderAuth();
  if (!user().profile) return renderProfile();
  markMissed();
  const u = user(), nav = [["dashboard", "⌂", "Dashboard"], ["study", "✦", "Study"], ["plan", "◫", "Study Plan"], ["materials", "▣", "Materials"], ["assistant", "✨", "AI Assistant"], ["progress", "◒", "Progress"], ["history", "◷", "History"], ["settings", "⚙", "Settings"]];
  const titles = Object.fromEntries(nav.map(n => [n[0], n[2]]));
  $app.innerHTML = `<div class="app-shell"><aside class="sidebar">${logo()}<nav class="side-nav">${nav.map(n => `<button class="nav-item ${ui.page === n[0] ? "active" : ""}" data-act="go" data-v="${n[0]}"><span>${n[1]}</span><span class="nav-text">${n[2]}</span></button>`).join("")}</nav>
    <div class="sidebar-bottom"><button class="nav-item" data-act="logout"><span>⎋</span><span class="nav-text">Log out</span></button></div></aside>
    <main class="main"><header class="topbar"><b>${titles[ui.page]}</b><div class="top-actions"><span class="muted">@${esc(u.profile.username)}</span><div class="avatar">${esc(u.profile.name.charAt(0).toUpperCase())}</div></div></header>
    <div class="content">${pageHTML()}</div></main></div>`;
}
function pageHTML() {
  return ({ dashboard: dashboardHTML, study: studyHTML, plan: planHTML, materials: materialsHTML, assistant: assistantHTML, progress: progressHTML, history: historyHTML, settings: settingsHTML })[ui.page]();
}
const head = (t, p, a = "") => `<div class="page-title"><div><h1>${t}</h1>${p ? `<p>${p}</p>` : ""}</div><div class="actions">${a}</div></div>`;

/* --- auth --- */
function renderAuth() {
  if (ui.authTab === "forgot") return renderForgot();
  const login = ui.authTab === "login";
  $app.innerHTML = `<div class="auth-wrap"><div class="auth-card">${logo()}
    <div class="tabs"><button class="${login ? "active" : ""}" data-act="tab" data-v="login">I have an account</button><button class="${!login ? "active" : ""}" data-act="tab" data-v="signup">I'm new</button></div>
    <h1>${login ? "Welcome back" : "Create your account"}</h1><p class="sub">${login ? "Log in to continue studying." : "Sign up to build your study plan."}</p>
    ${ui.ok ? `<div class="notice green mb">${esc(ui.ok)}</div>` : ""}${ui.err ? `<div class="notice red mb">${esc(ui.err)}</div>` : ""}
    <div class="form-group"><label>Email</label><input id="a_email" value="${esc(ui.loginEmail || "")}" class="input" type="email" placeholder="you@example.com" autocomplete="email" data-enter="${login ? "login" : "signup"}"></div>
    <div class="form-group"><label>Password</label><input id="a_pw" class="input" type="password" placeholder="••••••••" autocomplete="${login ? "current-password" : "new-password"}" data-enter="${login ? "login" : "signup"}"></div>
    ${login ? "" : `<div class="form-group"><label>Confirm password</label><input id="a_pw2" class="input" type="password" placeholder="••••••••" data-enter="signup"></div>`}
    ${login ? `<div style="text-align:right;margin:-6px 0 14px"><button class="link-btn" data-act="tab" data-v="forgot">Forgot password?</button></div>` : ""}
    <button class="btn btn-primary full" data-act="${login ? "login" : "signup"}">${login ? "Log in" : "Sign up"}</button>
    <p class="muted center mt">Accounts and study data are saved only in this browser.</p></div></div>`;
}

/* --- forgot password ---
   AUTH is backend-ready like AI: set AI_CONFIG.useBackend = true and implement
     POST /auth/forgot  { email }                    -> { ok, error? }   (email a one-time code)
     POST /auth/reset   { email, code, password }    -> { ok, error? }
   With no backend (default) it runs a local DEMO: the reset code is shown on screen
   because there is no email server. Never ship the demo path to production. */
const AUTH = {
  async requestReset(email) {
    if (AI_CONFIG.useBackend) { try { return await callBackend("/auth/forgot", { email }); } catch (e) { return { ok: false, error: "Couldn't reach the server. Try again." }; } }
    await wait(500);
    if (!db.users[email]) return { ok: false, error: "No account found with that email in this browser." };
    const code = String(Math.floor(100000 + Math.random() * 900000));
    db.resets = db.resets || {}; db.resets[email] = { code: hash(code), exp: Date.now() + 10 * 60000, tries: 0 }; save();
    return { ok: true, demoCode: code };
  },
  async confirmReset(email, code, password) {
    if (AI_CONFIG.useBackend) { try { return await callBackend("/auth/reset", { email, code, password }); } catch (e) { return { ok: false, error: "Couldn't reach the server. Try again." }; } }
    await wait(400);
    const r = (db.resets || {})[email], u = db.users[email];
    if (!r || !u) return { ok: false, error: "Request a new reset code first." };
    if (Date.now() > r.exp) { delete db.resets[email]; save(); return { ok: false, error: "That code has expired. Request a new one." }; }
    if (r.tries >= 5) { delete db.resets[email]; save(); return { ok: false, error: "Too many wrong attempts. Request a new code." }; }
    if (r.code !== hash(code)) { r.tries++; save(); return { ok: false, error: "Incorrect code." }; }
    u.pass = hash(password); delete db.resets[email]; save();
    return { ok: true };
  }
};
function renderForgot() {
  const f = ui.forgot || (ui.forgot = { step: 1, email: "", demoCode: null }), s2 = f.step === 2;
  $app.innerHTML = `<div class="auth-wrap"><div class="auth-card">${logo()}
    <h1>${s2 ? "Set a new password" : "Forgot your password?"}</h1>
    <p class="sub">${s2 ? `Enter the 6-digit code for <b>${esc(f.email)}</b> and choose a new password.` : "Enter your account email and we'll send you a reset code."}</p>
    ${ui.err ? `<div class="notice red mb">${esc(ui.err)}</div>` : ""}
    ${s2 && f.demoCode ? `<div class="notice yellow mb"><b>Demo mode:</b> there's no email server, so your code is <b style="letter-spacing:.15em">${esc(f.demoCode)}</b> (valid 10 minutes).</div>` : ""}
    ${s2 ? `<div class="form-group"><label>Reset code</label><input id="f_code" class="input" inputmode="numeric" maxlength="6" placeholder="123456" autocomplete="one-time-code" data-enter="forgotReset"></div>
    <div class="form-group"><label>New password</label><input id="f_pw" class="input" type="password" placeholder="At least 6 characters" autocomplete="new-password" data-enter="forgotReset"></div>
    <div class="form-group"><label>Confirm new password</label><input id="f_pw2" class="input" type="password" placeholder="••••••••" autocomplete="new-password" data-enter="forgotReset"></div>
    <button class="btn btn-primary full" data-act="forgotReset">Reset password</button>
    <button class="btn btn-ghost full mt-s" data-act="forgotSend" data-resend="1">Send a new code</button>`
    : `<div class="form-group"><label>Email</label><input id="f_email" class="input" type="email" placeholder="you@example.com" autocomplete="email" value="${esc(f.email)}" data-enter="forgotSend"></div>
    <button class="btn btn-primary full" data-act="forgotSend">Send reset code</button>`}
    <button class="btn btn-ghost full mt-s" data-act="tab" data-v="login">← Back to log in</button></div></div>`;
}

/* --- profile setup --- */
function subjectBlock(s, editable) {
  return `<div class="subject-card"><div class="card-header"><b>${esc(s.name)}</b><button class="btn btn-danger btn-sm" data-act="delSub" data-id="${s.id}">Remove</button></div>
    <div class="upload"><label>＋ Upload materials<input type="file" multiple hidden data-upload="${s.id}" accept=".pdf,.docx,.txt,.md,.csv,.html"></label><div class="muted small">Textbook, notes — PDF, Word, TXT, Markdown</div></div>
    ${s.files.map(f => `<div class="file"><span>📄</span><span class="grow">${esc(f.name)}</span>${statusBadge(f)}<button class="btn btn-ghost btn-sm" data-act="delFile" data-id="${s.id}" data-f="${f.id}">✕</button></div>`).join("")}
    <details><summary>Or paste notes / syllabus text</summary><textarea class="input mt-s" rows="4" placeholder="Paste text here…" data-sub="${s.id}" data-field="paste">${esc(s.paste || "")}</textarea></details>
    <div class="upload mt-s"><label>＋ Upload previous year question papers<input type="file" multiple hidden data-upload-pyq="${s.id}" accept=".pdf,.docx,.txt,.md,.csv,.html"></label><div class="muted small">Used to find frequently-asked / important topics</div></div>
    ${(s.pyqFiles || []).map(f => `<div class="file"><span>📝</span><span class="grow">${esc(f.name)}</span>${statusBadge(f)}<button class="btn btn-ghost btn-sm" data-act="delFile" data-id="${s.id}" data-f="${f.id}" data-field="pyqFiles">✕</button></div>`).join("")}
    <details><summary>Or paste previous year questions</summary><textarea class="input mt-s" rows="4" placeholder="Paste questions here, one per line…" data-sub="${s.id}" data-field="pyqPaste">${esc(s.pyqPaste || "")}</textarea></details></div>`;
}
function renderProfile() {
  if (!ui.draft.pInit) ui.draft = { pInit: 1, name: "", username: "", course: "", subjects: [], newSub: "" };
  $app.innerHTML = `<div class="auth-wrap"><div class="auth-card wide">${logo()}<div class="eyebrow mt">Step 1 · Your profile</div>
    <h1>Tell us about you</h1><p class="sub">Add your course, its subjects, and your study materials for each subject.</p>
    ${ui.err ? `<div class="notice red mb">${esc(ui.err)}</div>` : ""}
    <div class="grid grid-2"><div class="form-group"><label>Name</label><input class="input" data-bind="name" value="${esc(D("name"))}"></div>
    <div class="form-group"><label>Username</label><input class="input" data-bind="username" value="${esc(D("username"))}" placeholder="e.g. alex_25"></div></div>
    <div class="form-group"><label>Course you're studying</label><input class="input" data-bind="course" value="${esc(D("course"))}" placeholder="e.g. B.Tech Computer Science · Semester 3"></div>
    <div class="form-group"><label>Subjects in this course</label><div class="actions"><input class="input" style="flex:1;min-width:180px" id="newSub" data-bind="newSub" data-enter="addSub" placeholder="Subject name, e.g. Data Structures" value="${esc(D("newSub"))}"><button class="btn btn-secondary" data-act="addSub">Add subject</button></div></div>
    ${ui.draft.subjects.length ? ui.draft.subjects.map(s => subjectBlock(s)).join("") : `<div class="empty">Add at least one subject to continue.</div>`}
    <button class="btn btn-primary full mt" data-act="saveProfile">Save & go to Dashboard →</button>
    <button class="btn btn-ghost full mt-s" data-act="logout">Log out</button></div></div>`;
}

/* --- dashboard --- */
function dashboardHTML() {
  const u = user();
  if (ui.analyzing) return analyzingHTML();
  if (!u.exam || !u.plan) return examFormHTML();
  if (u.plan.status === "draft") return head("Dashboard", `Hi ${esc(u.profile.name)}!`) + `<div class="notice yellow">Your study plan is ready for review. <button class="btn btn-primary btn-sm" data-act="go" data-v="plan">Review plan →</button></div>`;
  const st = stats(), left = daysBetween(today(), u.exam.date), todays = u.plan.sessions.filter(s => s.date === today());
  const next = u.plan.sessions.filter(s => ["pending", "missed"].includes(s.status)).sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.start - b.start)[0];
  return head("Dashboard", `Hi ${esc(u.profile.name)}, here's where you stand.`, next ? `<button class="btn btn-primary" data-act="start" data-id="${next.id}">▶ Start next session</button>` : "") +
    (left <= 0 ? `<div class="notice yellow mb">Your exam date has arrived. <button class="btn btn-secondary btn-sm" data-act="newExam">Set up a new exam</button></div>` : "") +
    `<div class="hero mb"><div class="eyebrow" style="color:#c9cbff">${esc(u.exam.name)}</div><div class="stat">${left > 0 ? left + " day" + (left === 1 ? "" : "s") + " to go" : "Exam day"}</div><p>${fmtDate(u.exam.date)} · ${st.pct}% of your plan completed</p><div class="mt">${bar(st.pct)}</div></div>
    <div class="grid grid-4 mb"><div class="card"><div class="muted">Sessions done</div><div class="stat">${st.doneN}/${st.totalN}</div></div><div class="card"><div class="muted">Time studied</div><div class="stat">${fmtDur(st.studied)}</div></div><div class="card"><div class="muted">Avg recall</div><div class="stat">${st.recall ?? "–"}${st.recall != null ? "%" : ""}</div></div><div class="card"><div class="muted">Avg test</div><div class="stat">${st.test ?? "–"}${st.test != null ? "%" : ""}</div></div></div>
    ${st.missed.length ? `<div class="notice red mb"><b>${st.missed.length} session(s) in your backlog</b> (${fmtDur(st.missed.reduce((a, s) => a + s.minutes, 0))}). <button class="btn btn-secondary btn-sm" data-act="go" data-v="progress">Make a catch-up plan</button></div>` : ""}
    <div class="card"><h3>Today's sessions</h3>${todays.length ? todays.sort((a, b) => a.start - b.start).map(sessionRow).join("") : `<div class="empty">Nothing planned for today.</div>`}</div>`;
}
function sessionRow(s) {
  const t = topicOf(s.topicId) || { title: "Topic" };
  const b = { done: `<span class="badge b-green">Done</span>`, missed: `<span class="badge b-red">Missed</span>`, unscheduled: `<span class="badge b-yellow">Not scheduled</span>`, pending: `<span class="badge b-blue">${s.type === "revision" ? "Revision" : "Study"}</span>` }[s.status];
  return `<div class="row"><div class="row-time">${s.date ? fmtTime(s.start) + "<br>" + fmtDur(s.minutes) : fmtDur(s.minutes)}</div><div class="row-main"><strong>${esc(t.title)}</strong><span class="muted">${esc(subName(s.subjectId))}${s.date && s.status !== "pending" && s.status !== "done" ? " · planned " + fmtDate(s.date) : ""}</span></div>${b}${["pending", "missed", "unscheduled"].includes(s.status) ? `<button class="btn btn-secondary btn-sm" data-act="start" data-id="${s.id}">Start</button>` : ""}</div>`;
}
function examFormHTML() {
  const u = user(), subs = u.profile.subjects, def = { ex_hours: "3", ex_start: "18:00" };
  const dv = (k, d = "") => ui.draft[k] ?? def[k] ?? d;
  return head("Dashboard", `Hi ${esc(u.profile.name)}! Tell us about your exam and we'll build your plan.`) + (ui.err ? `<div class="notice red mb">${esc(ui.err)}</div>` : "") +
    `<div class="card"><div class="eyebrow">Step 2 · Exam details</div><div class="grid grid-2 mt"><div class="form-group"><label>Which exam do you have?</label><input class="input" data-bind="ex_name" value="${esc(dv("ex_name"))}" placeholder="e.g. Semester 3 End Exams"></div>
    <div class="form-group"><label>When is it? (exam date)</label><input class="input" type="date" min="${addDays(today(), 1)}" data-bind="ex_date" value="${esc(dv("ex_date"))}"></div>
    <div class="form-group"><label>When are you comfortable studying? (start time)</label><input class="input" type="time" data-bind="ex_start" value="${esc(dv("ex_start"))}"></div>
    <div class="form-group"><label>How long can you study per day?</label><select class="input" data-bind="ex_hours">${["1", "1.5", "2", "3", "4", "5", "6"].map(h => `<option value="${h}" ${dv("ex_hours") === h ? "selected" : ""}>${h} hour${h === "1" ? "" : "s"}</option>`).join("")}</select></div></div>
    <div class="form-group"><label>Which subjects does this exam cover?</label>${subs.map(s => `<label class="check"><input type="checkbox" data-bind="ex_sub_${s.id}" ${(ui.draft["ex_sub_" + s.id] ?? true) ? "checked" : ""}> ${esc(s.name)} <span class="muted">${s.files.some(f => f.status === "ok") || (s.paste || "").trim() ? "" : "(no readable material yet)"}</span></label>`).join("")}</div>
    <div class="form-group"><label>Topics you find difficult (per subject, comma-separated)</label>${subs.map(s => `<div class="mb"><div class="muted small">${esc(s.name)}</div><input class="input" data-bind="diff_${s.id}" value="${esc(dv("diff_" + s.id))}" placeholder="e.g. Trees, Graph algorithms"></div>`).join("")}</div>
    <button class="btn btn-primary full" data-act="analyze">Analyze my materials & create plan →</button></div>`;
}
function analyzingHTML() {
  const st = ["Reading your uploaded materials", "Finding exam topics in each subject", "Weighing difficult topics and time available", "Building your personalised plan"], a = ui.analyzing;
  return `<div class="card center" style="max-width:520px;margin:40px auto"><div class="spinner"></div><h3>Analyzing…</h3><div class="steps">${st.map((s, i) => `<div class="step ${i < a ? "done" : i === a ? "active" : ""}">${i < a ? "✓" : i === a ? "…" : "○"} ${s}</div>`).join("")}</div></div>`;
}

/* --- plan --- */
function planHTML() {
  const u = user(); if (!u.plan) return head("Study Plan", "") + `<div class="empty card">Set up your exam on the Dashboard first.</div>`;
  const P = u.plan, draft = P.status === "draft", days = {};
  P.sessions.forEach(s => s.date && (days[s.date] = days[s.date] || []).push(s));
  const total = P.sessions.reduce((a, s) => a + s.minutes, 0), sub = u.profile.subjects;
  return head(draft ? (P.revisions.length ? "Revised study plan" : "Your study plan") : "Study Plan", `${esc(u.exam.name)} · ${fmtDate(u.exam.date)}`, !draft ? `<button class="btn btn-secondary" data-act="go" data-v="study">Go to Study</button>` : "") +
    `<div class="grid grid-3 mb"><div class="card"><div class="muted">Topics found</div><div class="stat">${u.topics.length}</div></div><div class="card"><div class="muted">Study days</div><div class="stat">${Object.keys(days).length}</div></div><div class="card"><div class="muted">Total planned</div><div class="stat">${fmtDur(total)}</div></div></div>` +
    (P.left ? `<div class="notice yellow mb">⚠ ${P.left} session(s) (${fmtDur(P.leftMin)}) didn't fit before the exam. Suggest more daily hours or fewer days off.</div>` : "") +
    (P.applied.length || P.unapplied.length ? `<div class="notice green mb"><b>Your suggestions</b>${P.applied.length ? `<ul>${P.applied.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}${P.unapplied.length ? `<div class="muted mt-s">Couldn't apply: ${P.unapplied.map(esc).join("; ")}. Try wording like “more time on Trees”, “no study on Sundays”, “2 hours a day”, “shorter sessions”.</div>` : ""}</div>` : "") +
    (draft ? `<div class="card mb"><h3>Any suggestions or revisions?</h3><textarea class="input" rows="3" data-bind="fb" placeholder="e.g. More time on Trees. No study on Sundays. Start in the morning." >${esc(D("fb"))}</textarea><div class="actions mt"><button class="btn btn-secondary" data-act="revise">Apply suggestions</button><button class="btn btn-primary" data-act="approve">✓ Looks good — approve plan</button></div></div>` : `<div class="notice green mb">✓ Plan approved. Head to <b>Study</b> to begin.</div>`) +
    (u.topics.length ? "" : `<div class="notice red mb">No topics could be found. Add readable materials (or paste text) in Materials, then set up the exam again.</div>`) +
    `<div class="card">${Object.keys(days).sort().map(d => `<div class="day-head"><span>${fmtDate(d)}${d === today() ? " · Today" : ""}</span><span class="muted">${fmtDur(days[d].reduce((a, s) => a + s.minutes, 0))}</span></div>${days[d].sort((a, b) => a.start - b.start).map(s => { const t = topicOf(s.topicId); return `<div class="row"><div class="row-time">${fmtTime(s.start)}<br>${fmtDur(s.minutes)}</div><div class="row-main"><strong>${esc(t ? t.title : "")}</strong><span class="muted">${esc(subName(s.subjectId))}</span></div>${t && t.important ? `<span class="badge b-yellow">🔥 Important</span>` : ""}${t && t.difficult ? `<span class="badge b-red">Difficult</span>` : ""}<span class="badge ${s.type === "revision" ? "b-yellow" : "b-blue"}">${s.type === "revision" ? "Revision" : "Study"}</span>${s.status === "done" ? `<span class="badge b-green">Done</span>` : s.status === "missed" ? `<span class="badge b-red">Missed</span>` : ""}</div>`; }).join("")}`).join("") || `<div class="empty">No sessions.</div>`}</div>`;
}

/* --- materials --- */
function materialsHTML() {
  const u = user(), subs = u.profile.subjects;
  return head("Materials", "Your subjects, files and the topics found in them.") +
    `<div class="card mb"><div class="form-group" style="margin:0"><label>Add a subject</label><div class="actions"><input class="input" style="flex:1;min-width:180px" id="newSub" data-bind="newSub" data-enter="addSub" placeholder="Subject name" value="${esc(D("newSub"))}"><button class="btn btn-secondary" data-act="addSub">Add subject</button></div></div></div>` +
    subs.map(s => {
      const ts = u.topics.filter(t => t.subjectId === s.id), unmatched = s.unmatchedPYQ || [];
      return subjectBlock(s) + (ts.length ? `<div class="card mb"><h3>Topics found in ${esc(s.name)}</h3>${ts.map(t => `<div class="row"><div class="row-main"><strong>${esc(t.title)}</strong>${t.pyqQuestions && t.pyqQuestions.length ? `<span class="muted small">Seen in ${t.pyqCount} previous-year question(s)</span>` : ""}</div>${t.important ? `<span class="badge b-yellow">🔥 Important (PYQ)</span>` : ""}${t.difficult ? `<span class="badge b-red">Difficult</span>` : ""}</div>`).join("")}</div>` : "") +
        (unmatched.length ? `<div class="card mb"><h3>Other important questions from previous papers (${esc(s.name)})</h3><p class="muted mb">These frequently-asked questions didn't map cleanly to one topic — make sure you can answer them.</p>${unmatched.slice(0, 12).map(q => `<div class="row"><div class="row-main">${esc(q)}</div></div>`).join("")}</div>` : "");
    }).join("") +
    `<div class="notice">New material is used the next time you set up an exam (Settings → New exam).</div>`;
}

/* --- AI assistant: 3 AI features in one hub, each backed by AI.* above --- */
function assistantHTML() {
  const tab = ui.aiTab || "notes";
  const tabBtn = (k, l) => `<button class="btn btn-sm ${tab === k ? "btn-primary" : "btn-secondary"}" data-act="aiTab" data-v="${k}">${l}</button>`;
  return head("AI Assistant", "Three AI-powered tools. They run fully offline right now (mock AI) and are already wired to swap in a real backend — see AI_CONFIG in app.js.") +
    `<div class="actions mb">${tabBtn("notes", "🧠 AI Notes Generator")}${tabBtn("pyq", "📄 Previous-Year Question Analyzer")}${tabBtn("backlog", "🔁 AI Backlog Rescheduler")}</div>` +
    (tab === "pyq" ? pyqTabHTML() : tab === "backlog" ? backlogTabHTML() : notesTabHTML());
}
const aiLoadingCard = msg => `<div class="card mt center"><div class="spinner"></div><p class="muted">${esc(msg)}</p></div>`;

/* 1) AI Notes Generator (+ the existing Q&A chat, since both read the same material) */
function notesTabHTML() {
  const u = user();
  if (!u.topics.length) return `<div class="empty card">Upload materials and analyse a subject first (Materials page) — the AI Notes Generator reads what you've uploaded, it doesn't know anything else.</div>`;
  const chat = ui.chat || [];
  const notesTopic = ui.notesTopic ? u.topics.find(t => t.id === ui.notesTopic) : null;
  const subs = u.profile.subjects.filter(s => u.topics.some(t => t.subjectId === s.id));
  return `<div class="grid grid-2">
    <div class="card"><h3>Ask a question</h3>
    <div class="chat mb">${chat.length ? chat.map(m => `<div class="bubble ${m.role}">${esc(m.text)}${m.topicTitle ? `<div class="muted small mt-s">From: ${esc(m.topicTitle)}</div>` : ""}</div>`).join("") : `<p class="muted">Try: “Explain ${esc(u.topics[0].title)}” or “What is important for the exam?”</p>`}</div>
    <div class="actions"><input class="input" id="aiQ" style="flex:1;min-width:180px" placeholder="Ask about your subjects…" data-enter="askAI"><button class="btn btn-primary" data-act="askAI">Ask</button></div></div>
    <div class="card"><h3>🧠 AI Notes Generator</h3><p class="muted mb">Pick a topic from your uploaded textbook/material and the AI will generate structured notes.</p>
    <div class="form-group"><label>Topic</label><select class="input" id="notesTopicSel">${subs.map(s => `<optgroup label="${esc(s.name)}">${u.topics.filter(t => t.subjectId === s.id).map(t => `<option value="${t.id}" ${ui.notesTopic === t.id ? "selected" : ""}>${esc(t.title)}${t.important ? " 🔥" : ""}</option>`).join("")}</optgroup>`).join("")}</select></div>
    <button class="btn btn-primary full" data-act="genNotes">✨ Generate Notes</button></div>
    </div>
    ${ui.notesLoading ? aiLoadingCard("AI is generating notes from your material…") : notesTopic ? notesCardHTML(notesTopic) : ""}`;
}
function notesCardHTML(t) {
  const n = ui.notesCache && ui.notesCache[t.id];
  if (!n) return "";
  if (!n.overview && !(n.points || []).length) return `<div class="card mt notice yellow">No readable text found for “${esc(t.title)}” yet — upload or paste material for this subject first.</div>`;
  return `<div class="card mt"><div class="card-header"><h3 style="margin:0">📝 Notes · ${esc(t.title)}</h3>${t.important ? `<span class="badge b-yellow">🔥 Important (PYQ)</span>` : ""}</div>
    ${n.overview ? `<p class="mb">${esc(n.overview)}</p>` : ""}
    ${n.points && n.points.length ? `<h3>Key points</h3><ul class="notes">${n.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
    ${n.terms && n.terms.length ? `<h3 class="mt">Key terms</h3>${n.terms.map(x => `<div class="row"><div class="row-main"><strong>${esc(x.term)}</strong><span class="muted">${esc(x.def)}</span></div></div>`).join("")}` : ""}
    ${t.pyqQuestions && t.pyqQuestions.length ? `<h3 class="mt">Frequently asked (from previous year papers)</h3>${t.pyqQuestions.map(q => `<div class="row"><div class="row-main">${esc(q)}</div></div>`).join("")}` : ""}
    <button class="btn btn-ghost btn-sm mt" data-act="genNotes" data-redo="${t.id}">↻ Regenerate</button>
    </div>`;
}

/* 2) Previous-Year Question Analyzer */
function pyqTabHTML() {
  const u = user(), subs = u.profile.subjects;
  if (!subs.length) return `<div class="empty card">Add a subject first (Materials page).</div>`;
  const sel = ui.pyqSubject && subs.some(s => s.id === ui.pyqSubject) ? ui.pyqSubject : subs[0].id;
  const sub = subs.find(s => s.id === sel);
  const hasPapers = sub && ((sub.pyqFiles || []).some(f => f.status === "ok") || (sub.pyqPaste || "").trim());
  return `<div class="card"><h3>📄 Previous-Year Question Analyzer</h3><p class="muted mb">Upload previous-year question papers for a subject on the Materials page, then let AI find the topics that come up again and again.</p>
  <div class="form-group"><label>Subject</label><select class="input" id="pyqSubSel" data-select-act="pyqPick">${subs.map(s => `<option value="${s.id}" ${sel === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
  ${hasPapers ? `<button class="btn btn-primary" data-act="analyzePapers" data-id="${sel}">✨ Analyze Papers with AI</button>` : `<div class="notice yellow">No previous-year papers uploaded for ${esc(sub ? sub.name : "this subject")} yet. Add them in <b>Materials</b> (file upload or paste).</div>`}
  </div>
  ${ui.pyqLoading ? aiLoadingCard("AI is scanning your question papers…") : (ui.pyqResult && ui.pyqResult.subjectId === sel) ? pyqResultHTML(ui.pyqResult) : ""}`;
}
function pyqResultHTML(r) {
  return `<div class="card mt"><h3>Important & repeated topics</h3>
  ${r.topics.length ? r.topics.map(t => `<div class="row"><div class="row-main"><strong>${esc(t.title)}</strong><span class="muted">Seen in ${t.pyqCount} question(s) across your papers</span></div><span class="badge b-yellow">🔥 Important</span></div>`).join("") : `<p class="muted">No strong topic matches yet — see the questions below.</p>`}
  ${r.unmatched.length ? `<h3 class="mt">Frequently asked questions</h3>${r.unmatched.slice(0, 15).map(q => `<div class="row"><div class="row-main">${esc(q)}</div></div>`).join("")}` : ""}
  </div>`;
}

/* 3) AI Backlog Rescheduler */
function backlogTabHTML() {
  const u = user();
  if (!planApproved()) return `<div class="empty card">Approve a study plan first (Study Plan page) — then the AI Backlog Rescheduler can act on missed or pending sessions.</div>`;
  const st = stats();
  return `<div class="card"><h3>🔁 AI Backlog Rescheduler</h3><p class="muted mb">Give the AI your current backlog and timetable, and it proposes a fresh schedule that fits everything in before your exam.</p>
  ${st.missed.length ? `<div class="notice red mb">${st.missed.length} pending session(s) · ${fmtDur(st.missed.reduce((a, s) => a + s.minutes, 0))} behind schedule.</div>
  <div class="actions"><button class="btn btn-secondary" data-act="recover" data-v="0">Same daily hours</button><button class="btn btn-secondary" data-act="recover" data-v="60">+1 hour/day</button><button class="btn btn-secondary" data-act="recover" data-v="120">+2 hours/day</button></div>`
      : `<div class="notice green">🎉 No backlog right now — you're on track.</div>`}
  </div>
  ${ui.recoveryLoading ? aiLoadingCard("AI is rebuilding your schedule…") : ui.recovery ? recoveryHTML(ui.recovery) : ""}`;
}

/* --- study --- */
function studyHTML() {
  const u = user(); if (!planApproved()) return head("Study", "") + `<div class="empty card">Approve your study plan first.</div>`;
  if (ui.active) return sessionHTML();
  const S = u.plan.sessions, todo = S.filter(s => s.date === today() && s.status === "pending"), back = S.filter(s => ["missed", "unscheduled"].includes(s.status)), up = S.filter(s => s.status === "pending" && s.date > today()).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start).slice(0, 5);
  const sec = (t, l) => `<div class="card mb"><h3>${t}</h3>${l.length ? l.map(sessionRow).join("") : `<div class="muted">Nothing here.</div>`}</div>`;
  return head("Study", "Pick a session. You'll get notes, timed active-recall breaks and an optional test.") + sec("Today", todo) + (back.length ? sec("Backlog", back) : "") + sec("Coming up (study ahead)", up);
}
function sessionHTML() {
  const a = ui.active, s = sessOf(a.sid), t = topicOf(s.topicId), v = a.view, rec = user().settings.recallMin;
  const top = `<div class="card-header"><div><div class="eyebrow">${esc(subName(s.subjectId))} · ${s.type === "revision" ? "Revision" : "Study"}</div><h3 style="margin:2px 0 0;font-size:22px">${esc(t.title)}</h3></div><button class="btn btn-ghost btn-sm" data-act="abandon">✕ Leave</button></div>`;
  if (v === "recall") { const c = a.cards[a.ci]; return `<div class="card">${top}<div class="notice yellow mb">🧠 Active recall break — try to answer from memory before revealing.</div><div class="muted">Card ${a.ci + 1} of ${a.cards.length}</div>${bar((a.ci) / a.cards.length * 100)}<div class="flash mt"><div>${esc(c.q)}</div>${a.show ? `<div class="ans">${esc(c.a)}</div>` : ""}</div><div class="actions mt">${a.show ? `<button class="btn btn-primary" data-act="rate" data-v="1">✓ I remembered</button><button class="btn btn-secondary" data-act="rate" data-v="0">✗ Need review</button>` : `<button class="btn btn-primary" data-act="reveal">Show answer</button>`}</div></div>`; }
  if (v === "recallDone") return `<div class="card center">${top}<div class="stat">${a.rc}/${a.cards.length}</div><p class="muted mb">cards remembered. Nice work — back to studying.</p><button class="btn btn-primary" data-act="resume">Continue studying →</button></div>`;
  if (v === "finish") return `<div class="card center">${top}<div class="stat">🎉 Topic complete</div><p class="muted mb">You've finished all planned sessions for this topic. A quick test is optional but a good way to check your progress.</p><div class="actions" style="justify-content:center"><button class="btn btn-primary" data-act="startTest">Take a small test</button><button class="btn btn-ghost" data-act="skipTest">Skip for now</button></div></div>`;
  if (v === "test") { const q = a.qs[a.qi]; return `<div class="card">${top}<div class="muted">Question ${a.qi + 1} of ${a.qs.length}</div>${bar(a.qi / a.qs.length * 100)}<div class="question">Fill in the blank: ${esc(q.q)}</div>${q.options.map(o => `<button class="option ${a.picked ? (o === q.answer ? "right" : o === a.picked ? "wrong" : "") : ""}" data-act="pick" data-v="${esc(o)}" ${a.picked ? "disabled" : ""}>${esc(o)}</button>`).join("")}${a.picked ? `<button class="btn btn-primary mt" data-act="nextQ">${a.qi + 1 < a.qs.length ? "Next question →" : "See result"}</button>` : ""}</div>`; }
  if (v === "testDone") { const pct = Math.round(a.score / a.qs.length * 100); return `<div class="card center">${top}<div class="stat">${a.score}/${a.qs.length} (${pct}%)</div><p class="muted mb">${pct >= 60 ? "Solid grasp of this topic." : "This topic needs more work — " + (a.addedRev ? "a revision session has been added to your plan." : "review it again soon.")}</p><button class="btn btn-primary" data-act="leave">Back to Study</button></div>`; }
  const nt = notesFor(t), remain = Math.max(0, rec * 60 - a.since);
  return `<div class="grid grid-2" style="grid-template-columns:2fr 1fr"><div class="card">${top}${t.text.trim() ? (nt.points.length ? `<ul class="notes">${nt.points.map(p => `<li>${esc(p)}</li>`).join("")}</ul>` : `<div class="muted">This section has little sentence-style text.</div>`) : `<div class="notice yellow">Your materials had no notes for this topic. Study it from your textbook; recall cards will be general prompts.</div>`}
    ${nt.terms.length ? `<div class="mt"><div class="muted mb">Key terms</div><div class="chips">${nt.terms.map(x => `<span class="chip">${esc(x)}</span>`).join("")}</div></div>` : ""}
    ${t.text.trim() ? `<details><summary>Read the full material for this topic</summary><div class="rawtext">${esc(t.text.slice(0, 6000))}</div></details>` : ""}
    <button class="btn btn-secondary btn-sm mt" data-act="openNotes" data-id="${t.id}">✨ Generate full AI notes</button></div>
    <div class="card"><div class="muted">Time studied</div><div class="timer" id="tmr">${clock(a.elapsed)}</div><div class="muted">Planned ${fmtDur(s.minutes)}</div><div class="mt muted">Next active recall in</div><div class="stat" id="nrec">${clock(remain)}</div>
    <div class="actions mt"><button class="btn btn-secondary btn-sm" data-act="toggle">${a.running ? "⏸ Pause" : "▶ Resume"}</button><button class="btn btn-secondary btn-sm" data-act="recallNow">Recall now</button></div>
    <button class="btn btn-primary full mt" data-act="finish">✓ Finish this session</button></div></div>`;
}
function startSession(id) {
  const s = sessOf(id), t = topicOf(s.topicId);
  ui.active = { sid: id, view: "notes", elapsed: 0, since: 0, running: true, last: Date.now(), cards: [], ci: 0, show: false, rc: 0, qs: [], qi: 0, score: 0, picked: null, tid: t.id };
  ui.page = "study"; render();
}
function startRecall(auto) {
  const a = ui.active, t = topicOf(sessOf(a.sid).topicId); a.cards = cardsFor(t).slice(0, 8); a.ci = 0; a.rc = 0; a.show = false; a.view = "recall"; a.running = false;
  if (auto) toast("⏰ Time for active recall!");
  ui.page = "study"; render();
}
function tick() {
  const a = ui.active; if (!a || !db.current || !a.running || a.view !== "notes") return;
  const now = Date.now(), d = Math.min(5, (now - a.last) / 1000); a.last = now; a.elapsed += d; a.since += d;
  const rec = user().settings.recallMin * 60;
  if (a.since >= rec) return startRecall(true);
  const e = document.getElementById("tmr"), n = document.getElementById("nrec");
  if (e) e.textContent = clock(a.elapsed); if (n) n.textContent = clock(Math.max(0, rec - a.since));
}
setInterval(tick, 1000);
function completeSession(finishTopic) {
  const a = ui.active, s = sessOf(a.sid), t = topicOf(s.topicId), u = user();
  s.status = "done"; s.actual = Math.max(1, Math.round(a.elapsed / 60)); s.doneAt = Date.now();
  log("study", { subject: subName(s.subjectId), topic: t.title, minutes: s.actual, type: s.type });
  save();
}

/* --- progress & backlog --- */
function progressHTML() {
  const u = user(); if (!planApproved()) return head("Progress", "") + `<div class="empty card">Progress appears once your plan is approved.</div>`;
  const st = stats(), S = u.plan.sessions, rv = ui.recovery;
  const bySub = u.profile.subjects.filter(s => S.some(x => x.subjectId === s.id)).map(s => { const l = S.filter(x => x.subjectId === s.id), t = l.reduce((a, x) => a + x.minutes, 0), d = l.filter(x => x.status === "done").reduce((a, x) => a + x.minutes, 0); return `<div class="mb"><div class="card-header" style="margin-bottom:6px"><b>${esc(s.name)}</b><span class="muted">${t ? Math.round(d / t * 100) : 0}%</span></div>${bar(t ? d / t * 100 : 0)}</div>`; }).join("");
  const rows = u.topics.map(t => { const l = S.filter(x => x.topicId === t.id), d = l.filter(x => x.status === "done").length, m = l.filter(x => ["missed", "unscheduled"].includes(x.status)).length; return `<tr><td>${esc(t.title)}${t.important ? ` <span class="badge b-yellow">🔥</span>` : ""}</td><td>${esc(subName(t.subjectId))}</td><td>${d}/${l.length}</td><td>${t.lastTest != null ? t.lastTest + "%" : "–"}</td><td>${m ? `<span class="badge b-red">Backlog</span>` : d === l.length && l.length ? `<span class="badge b-green">Done</span>` : `<span class="badge b-blue">In progress</span>`}</td></tr>`; }).join("");
  return head("Progress", "How you're doing and what's still pending.") +
    `<div class="grid grid-4 mb"><div class="card"><div class="muted">Plan completed</div><div class="stat">${st.pct}%</div></div><div class="card"><div class="muted">Time studied</div><div class="stat">${fmtDur(st.studied)}</div></div><div class="card"><div class="muted">Avg recall</div><div class="stat">${st.recall != null ? st.recall + "%" : "–"}</div></div><div class="card"><div class="muted">Avg test</div><div class="stat">${st.test != null ? st.test + "%" : "–"}</div></div></div>
    <div class="grid grid-2 mb"><div class="card"><h3>By subject</h3>${bySub}</div>
    <div class="card"><h3>🔁 AI Backlog Rescheduler</h3>${st.missed.length ? `<p class="muted mb">${st.missed.length} pending session(s) · ${fmtDur(st.missed.reduce((a, s) => a + s.minutes, 0))}. Pick how much extra time you can add and the AI will re-plan the remaining days.</p><div class="actions"><button class="btn btn-secondary" data-act="recover" data-v="0">Same daily hours</button><button class="btn btn-secondary" data-act="recover" data-v="60">+1 hour/day</button><button class="btn btn-secondary" data-act="recover" data-v="120">+2 hours/day</button></div>` : `<div class="notice green">🎉 No backlog. You're on track.</div>`}</div></div>
    ${ui.recoveryLoading ? aiLoadingCard("AI is rebuilding your schedule…") : rv ? recoveryHTML(rv) : ""}
    <div class="card scroll-x"><h3>Topics</h3><table class="table"><thead><tr><th>Topic</th><th>Subject</th><th>Sessions</th><th>Last test</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function recoveryHTML(rv) {
  const days = {}; rv.placed.forEach(s => (days[s.date] = days[s.date] || []).push(s));
  return `<div class="card mb"><div class="card-header"><h3 style="margin:0">Catch-up plan (preview)</h3><div class="actions"><button class="btn btn-primary btn-sm" data-act="acceptRecovery">Accept catch-up plan</button><button class="btn btn-ghost btn-sm" data-act="cancelRecovery">Cancel</button></div></div>
    ${rv.left.length ? `<div class="notice yellow mb">⚠ ${rv.left.length} session(s) still don't fit before the exam. Try adding more daily time.</div>` : `<div class="notice green mb">Everything fits before your exam.</div>`}
    ${Object.keys(days).sort().map(d => `<div class="day-head"><span>${fmtDate(d)}</span><span class="muted">${fmtDur(days[d].reduce((a, s) => a + s.minutes, 0))}</span></div>${days[d].sort((a, b) => a.start - b.start).map(s => `<div class="row"><div class="row-time">${fmtTime(s.start)}<br>${fmtDur(s.minutes)}</div><div class="row-main"><strong>${esc((topicOf(s.topicId) || {}).title)}</strong><span class="muted">${esc(subName(s.subjectId))}</span></div>${s.wasMissed ? `<span class="badge b-red">Backlog</span>` : ""}<span class="badge ${s.type === "revision" ? "b-yellow" : "b-blue"}">${s.type === "revision" ? "Revision" : "Study"}</span></div>`).join("")}`).join("")}</div>`;
}

/* --- history --- */
function historyHTML() {
  const u = user(), f = ui.hist, H = u.history.filter(h => f === "all" || h.kind === f), groups = {};
  H.forEach(h => { const d = ymd(new Date(h.ts)); (groups[d] = groups[d] || []).push(h); });
  const chip = (k, l) => `<button class="btn btn-sm ${f === k ? "btn-primary" : "btn-secondary"}" data-act="hist" data-v="${k}">${l}</button>`;
  const line = h => {
    const w = new Date(h.ts).toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true });
    const m = { study: [`📖`, `Studied <b>${esc(h.topic)}</b>`, `${esc(h.subject)}${h.type === "revision" ? " · revision" : ""}`, `<span class="badge b-blue">${fmtDur(h.minutes)}</span>`], recall: [`🧠`, `Active recall · <b>${esc(h.topic)}</b>`, esc(h.subject), `<span class="badge b-yellow">${h.score}/${h.total} cards</span>`], test: [`📝`, `Test · <b>${esc(h.topic)}</b>`, esc(h.subject), `<span class="badge ${h.score / h.total >= .6 ? "b-green" : "b-red"}">${h.score}/${h.total}</span>`], missed: [`⚠️`, `Missed · <b>${esc(h.topic)}</b>`, `${esc(h.subject)} · planned ${h.planned ? fmtDate(h.planned) : ""}`, `<span class="badge b-red">Missed</span>`], plan: [`🗓️`, esc(h.text), "", ""] }[h.kind] || ["•", esc(h.text || h.kind), "", ""];
    return `<div class="row"><div class="row-time">${w}</div><div style="font-size:20px">${m[0]}</div><div class="row-main"><div>${m[1]}</div><span class="muted">${m[2]}</span></div>${m[3]}</div>`;
  };
  return head("History", "When and what you studied.") + `<div class="actions mb">${chip("all", "All")}${chip("study", "Study")}${chip("recall", "Recall")}${chip("test", "Tests")}${chip("missed", "Missed")}${chip("plan", "Plans")}</div>` +
    (H.length ? Object.keys(groups).sort().reverse().map(d => `<div class="card mb"><div class="card-header"><b>${fmtDate(d)}${d === today() ? " · Today" : ""}</b><span class="muted">${fmtDur(groups[d].filter(h => h.kind === "study").reduce((a, h) => a + h.minutes, 0))} studied</span></div>${groups[d].map(line).join("")}</div>`).join("") : `<div class="empty card">Nothing here yet. Finish a study session and it will appear.</div>`);
}

/* --- settings --- */
function settingsHTML() {
  const u = user();
  return head("Settings", "") + `<div class="card mb"><h3>Active recall reminder</h3><p class="muted mb">How long to study before a flashcard break.</p><select class="input" style="max-width:260px" data-setting="recallMin">${[[30, "Every 30 minutes"], [45, "Every 45 minutes"], [60, "Every 60 minutes"], [1, "Every 1 minute (demo)"]].map(o => `<option value="${o[0]}" ${u.settings.recallMin === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}</select></div>
    <div class="card mb"><h3>Exam & plan</h3><p class="muted mb">Start over with a new exam. Your history is kept.</p><button class="btn btn-secondary" data-act="newExam">New exam / new plan</button></div>
    <div class="card"><h3>Account</h3><p class="muted mb">${esc(u.profile.name)} · @${esc(u.profile.username)} · ${esc(u.email)}<br>${esc(u.profile.course)}</p><div class="actions"><button class="btn btn-secondary" data-act="logout">Log out</button><button class="btn btn-danger" data-act="wipe">Delete my account & data</button></div></div>`;
}

/* ---------- events ---------- */
const A = {
  tab(d) { ui.authTab = d.v; ui.err = ""; ui.ok = ""; if (d.v === "forgot") ui.forgot = { step: 1, email: val("a_email").trim().toLowerCase(), demoCode: null }; render(); },
  async forgotSend(d) {
    const f = ui.forgot || (ui.forgot = { step: 1, email: "" }), email = d && d.resend ? f.email : val("f_email").trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) { ui.err = "Enter a valid email."; f.email = email; return render(); }
    const r = await AUTH.requestReset(email);
    if (!r.ok) { ui.err = r.error || "Couldn't send a reset code."; f.email = email; return render(); }
    ui.err = ""; ui.forgot = { step: 2, email, demoCode: r.demoCode || null }; render();
    toast(r.demoCode ? "Reset code generated (demo)." : "Reset code sent — check your email.");
  },
  async forgotReset() {
    const f = ui.forgot, code = val("f_code").trim(), pw = val("f_pw"), pw2 = val("f_pw2");
    if (!/^\d{6}$/.test(code)) ui.err = "Enter the 6-digit code."; else if (pw.length < 6) ui.err = "Password must be at least 6 characters."; else if (pw !== pw2) ui.err = "Passwords don't match.";
    else { const r = await AUTH.confirmReset(f.email, code, pw); if (r.ok) { ui.err = ""; ui.ok = "Password updated. Log in with your new password."; ui.loginEmail = f.email; ui.authTab = "login"; ui.forgot = null; return render(); } ui.err = r.error || "Couldn't reset password."; }
    render();
  },
  chatToggle() { Chat.toggle(); },
  chatSend() { const el = document.getElementById("cw-in"); if (el) { const t = el.value; el.value = ""; Chat.send(t); } },
  chatClear() { Chat.clear(); },
  chatSuggest(d) { Chat.send(d.p); },
  chatAction(d) { Chat.runAction(+d.m, +d.a); },
  login() {
    const e = val("a_email").trim().toLowerCase(), p = val("a_pw"), u = db.users[e];
    if (!u || u.pass !== hash(p)) { ui.err = "Wrong email or password. New here? Choose “I'm new” to sign up."; return render(); }
    db.current = e; ui.err = ""; ui.page = "dashboard"; ui.draft = {}; save(); render();
  },
  signup() {
    const e = val("a_email").trim().toLowerCase(), p = val("a_pw"), p2 = val("a_pw2");
    if (!/^\S+@\S+\.\S+$/.test(e)) ui.err = "Enter a valid email."; else if (p.length < 6) ui.err = "Password must be at least 6 characters."; else if (p !== p2) ui.err = "Passwords don't match."; else if (db.users[e]) ui.err = "An account with this email already exists — log in instead.";
    else { db.users[e] = { email: e, pass: hash(p), profile: null, exam: null, topics: [], plan: null, history: [], settings: { recallMin: 30 } }; db.current = e; ui.err = ""; ui.draft = {}; save(); }
    render();
  },
  logout() { db.current = null; ui.active = null; ui.draft = {}; ui.err = ""; ui.authTab = "login"; save(); render(); },
  wipe() { if (confirm("Delete your account and all study data in this browser?")) { delete db.users[db.current]; db.current = null; ui.active = null; save(); render(); } },
  go(d) { ui.page = d.v; ui.recovery = null; render(); window.scrollTo(0, 0); },
  addSub() {
    const n = (ui.draft.newSub || "").trim(); if (!n) return toast("Type a subject name first.");
    const subs = subjectsRef(); if (subs.some(s => s.name.toLowerCase() === n.toLowerCase())) return toast("That subject is already added.");
    subs.push({ id: uid(), name: n, files: [], paste: "", pyqFiles: [], pyqPaste: "" }); ui.draft.newSub = ""; if (db.current) save(); render();
  },
  delSub(d) { if (!confirm("Remove this subject and its materials?")) return; const subs = subjectsRef(); subs.splice(subs.findIndex(s => s.id === d.id), 1); if (db.current) save(); render(); },
  delFile(d) { const s = subjectsRef().find(s => s.id === d.id); const field = d.field || "files"; s[field] = (s[field] || []).filter(f => f.id !== d.f); if (db.current) save(); render(); },
  saveProfile() {
    const d = ui.draft; ui.err = "";
    if (!d.name.trim() || !d.username.trim() || !d.course.trim()) ui.err = "Please fill in your name, username and course.";
    else if (!/^[a-z0-9_.]{3,20}$/i.test(d.username.trim())) ui.err = "Username: 3–20 letters, numbers, dots or underscores.";
    else if (Object.values(db.users).some(x => x.profile && x.profile.username.toLowerCase() === d.username.trim().toLowerCase())) ui.err = "That username is taken.";
    else if (!d.subjects.length) ui.err = "Add at least one subject.";
    if (ui.err) return render();
    user().profile = { name: d.name.trim(), username: d.username.trim(), course: d.course.trim(), subjects: d.subjects }; ui.draft = {}; ui.page = "dashboard"; save(); render();
  },
  analyze() {
    const u = user(), d = ui.draft, subs = u.profile.subjects; ui.err = "";
    const ids = subs.filter(s => d["ex_sub_" + s.id] ?? true).map(s => s.id), date = d.ex_date, name = (d.ex_name || "").trim();
    if (!name) ui.err = "Enter the exam name."; else if (!date || date <= today()) ui.err = "Pick an exam date after today."; else if (!ids.length) ui.err = "Select at least one subject."; else if (!(d.ex_start || "18:00")) ui.err = "Pick a start time.";
    if (ui.err) return render();
    const [h, m] = (d.ex_start || "18:00").split(":").map(Number), diff = {}; subs.forEach(s => diff[s.id] = d["diff_" + s.id] || "");
    u.exam = { name, date, subjectIds: ids, difficult: diff, startMin: h * 60 + m, hours: parseFloat(d.ex_hours || "3") };
    ui.analyzing = 0; ui.page = "dashboard"; render();
    setTimeout(() => { u.topics = analyze(u); ui.analyzing = 1; render(); }, 700);
    go2(2, 1400); go2(3, 2100);
    setTimeout(() => { createPlan(u); log("plan", { text: `Plan created for ${u.exam.name}` }); save(); ui.analyzing = null; ui.page = "plan"; ui.draft.fb = ""; render(); }, 2900);
    function go2(n, t) { setTimeout(() => { ui.analyzing = n; render(); }, t); }
  },
  revise() {
    const t = (ui.draft.fb || "").trim(); if (!t) return toast("Type a suggestion first.");
    reviseFromText(user(), t); ui.draft.fb = ""; save(); render();
  },
  approve() { const u = user(); u.plan.status = "approved"; log("plan", { text: `Plan approved for ${u.exam.name}${u.plan.revisions.length ? " (revised)" : ""}` }); save(); toast("Plan approved! Time to study."); ui.page = "study"; render(); },
  newExam() { if (!confirm("Start a new exam and plan? Your current plan will be replaced (history is kept).")) return; const u = user(); u.exam = null; u.plan = null; u.topics = []; ui.active = null; ui.draft = {}; ui.page = "dashboard"; save(); render(); },
  start(d) { startSession(d.id); },
  toggle() { const a = ui.active; a.running = !a.running; a.last = Date.now(); render(); },
  recallNow() { startRecall(false); },
  reveal() { ui.active.show = true; render(); },
  rate(d) {
    const a = ui.active; a.rc += +d.v; a.show = false; a.ci++;
    if (a.ci >= a.cards.length) { const s = sessOf(a.sid), t = topicOf(s.topicId); log("recall", { subject: subName(s.subjectId), topic: t.title, score: a.rc, total: a.cards.length }); save(); a.view = "recallDone"; }
    render();
  },
  resume() { const a = ui.active; a.view = "notes"; a.since = 0; a.running = true; a.last = Date.now(); render(); },
  finish() {
    const a = ui.active, s = sessOf(a.sid), t = topicOf(s.topicId), u = user(); a.running = false;
    completeSession();
    const more = u.plan.sessions.some(x => x.topicId === t.id && x.type === "study" && x.status !== "done");
    if (!more && s.type === "study") { a.view = "finish"; render(); } else { ui.active = null; toast("Session saved ✓"); render(); }
  },
  skipTest() { ui.active = null; toast("Topic done ✓"); render(); },
  startTest() {
    const a = ui.active, t = topicOf(sessOf(a.sid).topicId), u = user(); a.qs = questionsFor(t, u.topics);
    if (!a.qs.length) { ui.active = null; return toast("Not enough material to build a test for this topic."), render(); }
    a.qi = 0; a.score = 0; a.picked = null; a.view = "test"; render();
  },
  pick(d) { const a = ui.active; a.picked = d.v; if (d.v === a.qs[a.qi].answer) a.score++; render(); },
  nextQ() {
    const a = ui.active; a.qi++; a.picked = null;
    if (a.qi >= a.qs.length) {
      const s = sessOf(a.sid), t = topicOf(s.topicId), pct = Math.round(a.score / a.qs.length * 100); t.lastTest = pct;
      log("test", { subject: subName(s.subjectId), topic: t.title, score: a.score, total: a.qs.length });
      a.addedRev = pct < 60 ? addRevision(t) : false; save(); a.view = "testDone";
    }
    render();
  },
  leave() { ui.active = null; render(); },
  abandon() { if (ui.active.elapsed > 60 && !confirm("Leave without finishing? This session won't be marked done.")) return; ui.active = null; render(); },
  async recover(d) {
    ui.recoveryLoading = true; ui.recovery = null; render();
    const rv = await AI.rescheduleBacklog(+d.v);
    ui.recoveryLoading = false; ui.recovery = rv; render();
  },
  cancelRecovery() { ui.recovery = null; ui.recoveryLoading = false; render(); },
  acceptRecovery() {
    const u = user(), rv = ui.recovery, done = u.plan.sessions.filter(s => s.status === "done");
    rv.left.forEach(s => { s.date = null; s.status = "unscheduled"; });
    u.plan.sessions = [...done, ...rv.placed, ...rv.left]; log("plan", { text: `AI catch-up plan created (${rv.placed.length} sessions re-scheduled${rv.left.length ? ", " + rv.left.length + " didn't fit" : ""})` });
    ui.recovery = null; ui.active = null; save(); toast("Catch-up plan saved ✓"); render();
  },
  hist(d) { ui.hist = d.v; render(); },
  aiTab(d) { ui.aiTab = d.v; render(); },
  pyqPick(d) { ui.pyqSubject = d.v; ui.pyqResult = null; render(); },
  askAI() {
    const q = val("aiQ").trim(); if (!q) return;
    const ans = answerQuestion(user(), q);
    ui.chat = ui.chat || []; ui.chat.push({ role: "user", text: q }); ui.chat.push({ role: "ai", text: ans.text, topicTitle: ans.topic ? ans.topic.title : null });
    if (ui.chat.length > 20) ui.chat = ui.chat.slice(-20);
    render(); const el = document.getElementById("aiQ"); if (el) el.value = "";
  },
  genNotes(d) { const id = (d && d.redo) || (document.getElementById("notesTopicSel") || {}).value; if (!id) return; loadNotes(id); },
  openNotes(d) { ui.aiTab = "notes"; ui.page = "assistant"; loadNotes(d.id); window.scrollTo(0, 0); },
  async analyzePapers(d) {
    const sub = user().profile.subjects.find(s => s.id === d.id); if (!sub) return;
    ui.pyqLoading = true; ui.pyqResult = null; render();
    const r = await AI.analyzePapers(sub);
    ui.pyqLoading = false; ui.pyqResult = r; render();
  }
};
async function loadNotes(topicId) {
  ui.notesTopic = topicId; ui.notesLoading = true; render();
  const t = user().topics.find(x => x.id === topicId);
  const notes = t ? await AI.generateNotes(t) : { overview: "", points: [], terms: [] };
  ui.notesCache = ui.notesCache || {}; ui.notesCache[topicId] = notes;
  ui.notesLoading = false; render();
}
const val = id => (document.getElementById(id) || {}).value || "";
document.addEventListener("click", e => { const t = e.target.closest("[data-act]"); if (t && A[t.dataset.act]) A[t.dataset.act](t.dataset, e); });
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.dataset && e.target.dataset.enter) A[e.target.dataset.enter](); });
document.addEventListener("input", e => {
  const t = e.target;
  if (t.dataset.bind) ui.draft[t.dataset.bind] = t.type === "checkbox" ? t.checked : t.value;
  if (t.dataset.sub) { const s = subjectsRef().find(s => s.id === t.dataset.sub); if (s) { s[t.dataset.field] = t.value; if (db.current && user().profile) save(); } }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.bind && t.type === "checkbox") ui.draft[t.dataset.bind] = t.checked;
  if (t.dataset.upload) { handleFiles(t.dataset.upload, [...t.files]); t.value = ""; }
  if (t.dataset.uploadPyq) { handleFiles(t.dataset.uploadPyq, [...t.files], "pyqFiles"); t.value = ""; }
  if (t.dataset.setting) { user().settings[t.dataset.setting] = +t.value; save(); toast("Saved"); }
  if (t.dataset.selectAct && A[t.dataset.selectAct]) A[t.dataset.selectAct]({ v: t.value });
});
/* ============================================================
   FLOATING AI CHATBOT
   A bottom-right assistant that is aware of where you are in the
   app (page, active study session, exam, plan, backlog, topics,
   past papers). It lives in its own #chat-root, so page re-renders
   never wipe an open conversation.

   Backend contract (optional) — set AI_CONFIG.useBackend = true:
     POST {baseUrl}/ai/chat
       { message, history:[{role:"user"|"ai", text}], context:{...see chatContext()} }
     -> { text, actions?:[ {label, type:"go",page} | {type:"notes",topicId}
                          | {type:"start",sessionId} | {type:"pyq",subjectId}
                          | {type:"backlog",extra} | {type:"chat",prompt} ] }
   If the call fails it falls back to the offline mock below.
   ============================================================ */
const CW_PAGES = { dashboard: "Dashboard", study: "Study", plan: "Study Plan", materials: "Materials", assistant: "AI Assistant", progress: "Progress", history: "History", settings: "Settings" };
const cwClip = (s, n) => s.length > n ? s.slice(0, n - 1).trim() + "…" : s;
const cwFmt = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/^(?:- |• )/gm, "• ");

function chatContext() {
  const u = user(), ex = u.exam, P = u.plan;
  const ctx = {
    page: ui.page, pageTitle: CW_PAGES[ui.page] || ui.page,
    student: { name: u.profile.name, course: u.profile.course },
    subjects: u.profile.subjects.map(s => ({ id: s.id, name: s.name, materials: s.files.filter(f => f.status === "ok").length + ((s.paste || "").trim() ? 1 : 0), pastPapers: (s.pyqFiles || []).filter(f => f.status === "ok").length + ((s.pyqPaste || "").trim() ? 1 : 0) })),
    exam: ex ? { name: ex.name, date: ex.date, daysLeft: daysBetween(today(), ex.date) } : null,
    planStatus: P ? P.status : "none", topicCount: u.topics.length,
    importantTopics: u.topics.filter(t => t.important).map(t => t.title).slice(0, 8),
    difficultTopics: u.topics.filter(t => t.difficult).map(t => t.title).slice(0, 8)
  };
  if (P && P.status === "approved") {
    const st = stats(), sessions = P.sessions.filter(s => s.date === today()).sort((a, b) => a.start - b.start);
    ctx.progress = { percent: st.pct, sessionsDone: st.doneN, sessionsTotal: st.totalN, minutesStudied: st.studied, recallAvg: st.recall, testAvg: st.test };
    ctx.backlog = { sessions: st.missed.length, minutes: st.missed.reduce((a, s) => a + s.minutes, 0) };
    ctx.today = sessions.map(s => ({ id: s.id, topic: (topicOf(s.topicId) || {}).title, subject: subName(s.subjectId), start: s.start, minutes: s.minutes, status: s.status, type: s.type }));
  }
  if (ui.active && P) { const s = sessOf(ui.active.sid), t = s && topicOf(s.topicId); if (t) ctx.activeSession = { topic: t.title, subject: subName(s.subjectId), view: ui.active.view, minutesStudied: Math.round(ui.active.elapsed / 60) }; }
  return ctx;
}

/* ---- offline mock brain (replace with the backend above) ---- */
function chatFindTopic(msg, ctx) {
  const u = user(), m = msg.toLowerCase(), mw = new Set(words(msg)); let best = null, bs = 0;
  u.topics.forEach(t => { let s = 0; if (m.includes(t.title.toLowerCase())) s += 10; words(t.title).forEach(w => { if (mw.has(w)) s += 3; }); if (s > bs) { bs = s; best = t; } });
  if (bs >= 3) return best;
  const sub = u.profile.subjects.find(s => m.includes(s.name.toLowerCase()));
  if (sub) { const l = u.topics.filter(t => t.subjectId === sub.id); if (l.length) return l.find(t => t.important) || l.find(t => t.difficult) || l[0]; }
  if (ctx.activeSession && /\b(this|current|it|here)\b/.test(m)) return topicOf(sessOf(ui.active.sid).topicId);
  return null;
}
function chatFocusTopic() {
  const u = user();
  if (ui.active && u.plan) { const s = sessOf(ui.active.sid); if (s) return topicOf(s.topicId); }
  return u.topics.find(t => t.important) || u.topics.find(t => t.difficult) || u.topics[0] || null;
}
function mockChat(msg, ctx) {
  const u = user(), m = msg.toLowerCase(), name = u.profile.name.split(" ")[0];
  const go = (page, label) => ({ label, type: "go", page });
  const noPlan = () => !u.exam || !u.plan ? { text: "You haven't set up an exam yet. Tell me your exam, date, difficult topics and study hours on the **Dashboard** and I'll build your plan.", actions: [go("dashboard", "⌂ Open Dashboard")] } : u.plan.status !== "approved" ? { text: "Your study plan is still a draft. Review it, add any suggestions, then approve it — after that I can track your progress and backlog.", actions: [go("plan", "◫ Review plan")] } : null;

  // 1) backlog
  if (/backlog|missed|behind|catch.?up|overdue|pending|reschedul|fell behind/.test(m)) {
    const np = noPlan(); if (np) return np;
    const st = stats(); if (!st.missed.length) return { text: `You're on track, ${name} ✅ — no missed or pending sessions right now. ${ctx.today && ctx.today.some(s => s.status === "pending") ? "Today's sessions are still waiting for you." : ""}`.trim(), actions: [go("study", "✦ Go to Study")] };
    const mins = st.missed.reduce((a, s) => a + s.minutes, 0), titles = [...new Set(st.missed.map(s => (topicOf(s.topicId) || {}).title).filter(Boolean))].slice(0, 3);
    let pick = null; for (const extra of [0, 60, 120]) { if (!makeRecovery(extra).left.length) { pick = extra; break; } }
    const verdict = pick === 0 ? "Good news: everything fits before the exam at your current daily hours." : pick ? `It all fits if you add about **${pick / 60} extra hour${pick > 60 ? "s" : ""} per day**.` : "Even with +2 hours/day, some sessions won't fit. I'd protect the important and difficult topics first and trim low-priority revision.";
    return { text: `You have **${st.missed.length} session(s)** (${fmtDur(mins)}) behind schedule${titles.length ? `, mostly **${titles.join(", ")}**` : ""}. ${ctx.exam ? `${Math.max(0, ctx.exam.daysLeft)} day(s) until your exam.` : ""}\n${verdict}`, actions: [{ label: `🔁 Preview catch-up plan (${pick ? "+" + pick / 60 + "h/day" : "same hours"})`, type: "backlog", extra: pick || 0 }] };
  }
  // 2) question papers
  if (/question paper|past paper|previous.?year|pyq|old paper|exam pattern|repeated|frequently asked|important (topics|questions)/.test(m)) {
    const subs = u.profile.subjects.filter(s => (s.pyqFiles || []).some(f => f.status === "ok") || (s.pyqPaste || "").trim());
    if (!subs.length) return { text: "I don't see any previous-year papers yet. Upload them (or paste the questions) under each subject on the **Materials** page and I'll find the topics that keep repeating.", actions: [go("materials", "▣ Open Materials")] };
    const lines = [], actions = [];
    subs.slice(0, 3).forEach(sub => {
      if (!u.topics.some(t => t.subjectId === sub.id && t.important)) { try { mockAnalyzePapers(sub); } catch (e) {} }
      const hot = u.topics.filter(t => t.subjectId === sub.id && t.important).sort((a, b) => (b.pyqCount || 0) - (a.pyqCount || 0)).slice(0, 5);
      lines.push(hot.length ? `**${sub.name}** — ${hot.map(t => `${t.title} (${t.pyqCount}×)`).join(", ")}` : `**${sub.name}** — no strong topic matches yet; ${(sub.unmatchedPYQ || []).length} frequently asked question(s) found.`);
      actions.push({ label: `📄 Open ${cwClip(sub.name, 18)} analysis`, type: "pyq", subjectId: sub.id });
    });
    const top = u.topics.filter(t => t.important).sort((a, b) => (b.pyqCount || 0) - (a.pyqCount || 0))[0];
    return { text: `Here's what your past papers point to:\n${lines.join("\n")}\nStart with the topics that appear most often — they're the likeliest to come again.`, actions: [...actions.slice(0, 2), ...(top ? [{ label: `📝 Notes: ${cwClip(top.title, 20)}`, type: "notes", topicId: top.id }] : [])] };
  }
  // 3) quiz
  if (/\bquiz\b|test me|flash ?cards?|question me/.test(m)) {
    const t = chatFindTopic(msg, ctx) || chatFocusTopic(); if (!t) return { text: "Add some study material first, then I can quiz you on it.", actions: [go("materials", "▣ Open Materials")] };
    const cards = cardsFor(t).slice(0, 3);
    return { text: `Quick quiz on **${t.title}** — try answering from memory:\n${cards.map((c, i) => `${i + 1}. ${c.q}`).join("\n")}\nWhen you're ready, check your answers against the notes.`, actions: [{ label: "📝 Open notes", type: "notes", topicId: t.id }] };
  }
  // 4) study planning
  if (/\b(plan|schedule|timetable|today|tomorrow|this week|next session|what should i|study now|what to study|exam)\b/.test(m) && !/(notes?|explain|summar)/.test(m)) {
    const np = noPlan(); if (np) return np;
    const P = u.plan, t = P.sessions.filter(s => s.date === today()).sort((a, b) => a.start - b.start), pendingNext = P.sessions.filter(s => s.status === "pending").sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.start - b.start)[0], st = stats();
    const hard = u.topics.filter(x => x.difficult).map(x => x.title)[0];
    const todayTxt = t.length ? t.map(s => `- ${fmtTime(s.start)} · ${(topicOf(s.topicId) || {}).title} (${fmtDur(s.minutes)})${s.status === "done" ? " ✅" : s.status === "missed" ? " ⚠" : ""}`).join("\n") : "Nothing is scheduled today — a good day to study ahead or clear backlog.";
    return { text: `**${Math.max(0, ctx.exam.daysLeft)} day(s)** to ${ctx.exam.name}; your plan is **${st.pct}%** complete.\nToday:\n${todayTxt}${hard ? `\nTip: do **${hard}** early in your session while you're fresh.` : ""}${st.missed.length ? `\nYou also have ${st.missed.length} backlog session(s) — ask me to fix that.` : ""}`, actions: [...(pendingNext ? [{ label: "▶ Start next session", type: "start", sessionId: pendingNext.id }] : []), go("plan", "◫ Open plan")] };
  }
  // 5) progress
  if (/progress|how am i doing|performance|score|streak/.test(m)) {
    const np = noPlan(); if (np) return np; const st = stats();
    return { text: `Plan **${st.pct}%** done — ${st.doneN}/${st.totalN} sessions, ${fmtDur(st.studied)} studied.${st.recall != null ? ` Recall average **${st.recall}%**.` : ""}${st.test != null ? ` Test average **${st.test}%**.` : ""}${st.missed.length ? ` ${st.missed.length} session(s) in backlog.` : " No backlog 🎉"}`, actions: [go("progress", "◒ Open Progress")] };
  }
  // 6) notes / explain
  if (/\b(notes?|explain|summar\w*|revise|revision|overview|teach|understand|key points?|what is|what are)\b/.test(m)) {
    if (!u.topics.length) return { text: "I read from what you upload, and there's nothing to read yet. Add your textbook or notes on the **Materials** page and I'll turn them into notes.", actions: [go("materials", "▣ Open Materials")] };
    const t = chatFindTopic(msg, ctx);
    if (!t) { const list = [...u.topics].sort((a, b) => (b.important ? 2 : 0) + (b.difficult ? 1 : 0) - ((a.important ? 2 : 0) + (a.difficult ? 1 : 0))).slice(0, 4); return { text: "Which topic should I make notes on? Pick one from your material:", actions: list.map(x => ({ label: `📝 ${cwClip(x.title, 24)}`, type: "notes", topicId: x.id })) }; }
    const n = fullNotesFor(t); if (!n.overview && !n.points.length) return { text: `I couldn't find readable text for **${t.title}** yet. Upload or paste material for that subject and try again.`, actions: [go("materials", "▣ Open Materials")] };
    return { text: `**${t.title}** — quick notes${t.important ? " 🔥 (appears in past papers)" : ""}\n${cwClip(n.overview, 320)}\n\nKey points:\n${n.points.slice(0, 4).map(p => `- ${cwClip(p, 170)}`).join("\n")}`, actions: [{ label: "📝 Open full notes", type: "notes", topicId: t.id }, { label: "🧠 Quiz me", type: "chat", prompt: `Quiz me on ${t.title}` }] };
  }
  // 7) small talk & help
  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/.test(m)) return { text: `Hi ${name}! 👋 You're on **${ctx.pageTitle}**. I can make notes from your material, fix your backlog, analyze past question papers and plan your study. What would you like?`, actions: [] };
  if (/thank/.test(m)) return { text: "Anytime! Keep going — small steady sessions beat last-minute cramming. 💪", actions: [] };
  if (/help|what can you do|how do you work/.test(m)) return { text: "I can:\n- 📝 make quick notes and quizzes from your uploaded material\n- 🔁 check your backlog and preview a catch-up plan\n- 📄 find repeated topics in previous-year papers\n- 🗓️ tell you what to study today and how you're progressing", actions: [] };
  // 8) fall back to answering from the material
  const a = answerQuestion(u, msg);
  if (a.topic) return { text: a.text, actions: [{ label: `📝 Notes: ${cwClip(a.topic.title, 22)}`, type: "notes", topicId: a.topic.id }] };
  return { text: "I'm not sure I got that. I can help with notes, your backlog, question-paper analysis and study planning — try one of the suggestions below.", actions: [] };
}
AI.chat = async function (message, history, context) {
  if (AI_CONFIG.useBackend) {
    try { return await callBackend("/ai/chat", { message, history, context }); }
    catch (e) { toast("AI backend unreachable — using the offline assistant."); }
  }
  await wait(650 + Math.random() * 600); // simulated "thinking" so the typing animation shows
  return mockChat(message, context);
};

/* ---- widget ---- */
const CHAT_ACTIONS = {
  go(a) { ui.page = a.page; ui.recovery = null; render(); window.scrollTo(0, 0); },
  notes(a) { A.openNotes({ id: a.topicId }); },
  start(a) { A.start({ id: a.sessionId }); },
  pyq(a) { ui.aiTab = "pyq"; ui.pyqSubject = a.subjectId; ui.pyqResult = null; ui.page = "assistant"; A.analyzePapers({ id: a.subjectId }); },
  backlog(a) { ui.aiTab = "backlog"; ui.page = "assistant"; A.recover({ v: a.extra || 0 }); },
  chat(a) { Chat.send(a.prompt); }
};
const Chat = {
  open: false, typing: false, msgs: [], uid: null, root: null, fresh: -1,
  mount() {
    if (this.root) return;
    const r = this.root = document.createElement("div"); r.id = "chat-root"; r.hidden = true;
    r.innerHTML = `<button class="cw-fab" data-act="chatToggle" aria-label="Open StudySync AI assistant" aria-expanded="false"><span class="cw-fab-ic">✨</span><span class="cw-fab-x">✕</span></button>
    <section class="cw-pop" role="dialog" aria-label="StudySync AI assistant" aria-hidden="true">
      <header class="cw-head"><div class="cw-av">✨</div><div class="cw-title"><b>StudySync AI</b><span class="cw-ctx" id="cw-ctx"></span></div><button class="cw-ib" data-act="chatClear" title="Clear chat" aria-label="Clear chat">🗑</button><button class="cw-ib" data-act="chatToggle" title="Close" aria-label="Close chat">✕</button></header>
      <div class="cw-msgs" id="cw-msgs" aria-live="polite"></div>
      <div class="cw-chips" id="cw-chips"></div>
      <div class="cw-input"><input id="cw-in" class="cw-field" placeholder="Ask about notes, backlog, papers, your plan…" autocomplete="off" data-enter="chatSend" aria-label="Message"><button class="cw-send" data-act="chatSend" aria-label="Send">➤</button></div>
    </section>`;
    document.body.appendChild(r);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && this.open) this.toggle(); });
  },
  sync() {
    this.mount();
    const show = !!(db.current && user() && user().profile);
    this.root.hidden = !show;
    if (!show) { this.open = false; this.uid = null; this.applyOpen(); return; }
    if (this.uid !== db.current) { this.uid = db.current; this.msgs = (user().chat || []).slice(); this.fresh = -1; this.renderMsgs(); }
    this.renderHead(); this.renderChips();
  },
  toggle() { this.open = !this.open; this.applyOpen(); if (this.open) { this.renderMsgs(); const i = document.getElementById("cw-in"); if (i) setTimeout(() => i.focus(), 220); } },
  applyOpen() {
    const pop = this.root.querySelector(".cw-pop"), fab = this.root.querySelector(".cw-fab");
    pop.classList.toggle("open", this.open); fab.classList.toggle("open", this.open);
    pop.setAttribute("aria-hidden", String(!this.open)); fab.setAttribute("aria-expanded", String(this.open));
  },
  renderHead() { const el = document.getElementById("cw-ctx"); if (!el) return; const c = chatContext(); el.textContent = "📍 " + c.pageTitle + (c.activeSession ? " · " + cwClip(c.activeSession.topic, 22) : ""); },
  chips() {
    const u = user(), t = chatFocusTopic(), c = [];
    c.push({ l: t ? "📝 Notes: " + cwClip(t.title, 20) : "📝 Make study notes", p: t ? `Explain ${t.title} and give me key notes` : "Make notes for my topics" });
    const n = u.plan && u.plan.status === "approved" ? stats().missed.length : 0;
    c.push({ l: n ? `🔁 Fix my backlog (${n})` : "🔁 Check my backlog", p: "Help me catch up on my backlog" });
    c.push({ l: "📄 Analyze question papers", p: "Analyze my previous year question papers" });
    c.push({ l: "🗓️ Plan my study today", p: "What should I study today?" });
    if (ui.active && t) c.push({ l: "🧠 Quiz me on this topic", p: `Quiz me on ${t.title}` });
    else if (ui.page === "progress") c.push({ l: "📊 How am I doing?", p: "How am I doing?" });
    return c;
  },
  renderChips() { const el = document.getElementById("cw-chips"); if (el) el.innerHTML = this.chips().map(c => `<button class="cw-chip" data-act="chatSuggest" data-p="${esc(c.p)}">${esc(c.l)}</button>`).join(""); },
  welcome() {
    const u = user(), c = chatContext(), name = u.profile.name.split(" ")[0];
    return `Hi ${name}! 👋 I'm your StudySync assistant. You're on **${c.pageTitle}**${c.exam ? ` and your exam is in **${Math.max(0, c.exam.daysLeft)} day(s)**` : ""}.\nAsk me anything, or pick a suggestion below.${AI_CONFIG.useBackend ? "" : "\n\n(Offline demo mode — I answer from your uploaded material. A real AI backend can be plugged in via AI_CONFIG.)"}`;
  },
  renderMsgs() {
    const el = document.getElementById("cw-msgs"); if (!el) return;
    const bub = (m, i) => `<div class="cw-m ${m.role}${i === this.fresh ? " new" : ""}"><div class="cw-b">${cwFmt(m.text)}</div>${m.actions && m.actions.length ? `<div class="cw-acts">${m.actions.map((a, j) => `<button class="cw-act" data-act="chatAction" data-m="${i}" data-a="${j}">${esc(a.label)}</button>`).join("")}</div>` : ""}</div>`;
    el.innerHTML = (this.msgs.length ? "" : `<div class="cw-m ai"><div class="cw-b">${cwFmt(this.welcome())}</div></div>`) + this.msgs.map(bub).join("") + (this.typing ? `<div class="cw-m ai new"><div class="cw-b cw-dots" aria-label="AI is typing"><span></span><span></span><span></span></div></div>` : "");
    this.fresh = -1; el.scrollTop = el.scrollHeight;
  },
  persist() { const u = user(); if (!u) return; u.chat = this.msgs.slice(-40); save(); },
  async send(text) {
    text = (text || "").trim(); if (!text || this.typing || !user()) return;
    if (!this.open) { this.open = true; this.applyOpen(); }
    this.msgs.push({ role: "user", text: text.slice(0, 600) }); this.fresh = this.msgs.length - 1; this.typing = true; this.renderMsgs();
    const history = this.msgs.slice(-9, -1).map(m => ({ role: m.role, text: m.text }));
    let r;
    try { r = await AI.chat(text, history, chatContext()); } catch (e) { r = null; }
    if (!r || !r.text) r = { text: "Sorry, I hit a problem answering that. Please try again.", actions: [] };
    if (!db.current || this.uid !== db.current) { this.typing = false; return; }
    this.typing = false; this.msgs.push({ role: "ai", text: String(r.text), actions: (r.actions || []).slice(0, 4) }); this.fresh = this.msgs.length - 1;
    this.persist(); this.renderMsgs(); this.renderChips();
  },
  runAction(mi, ai) {
    const m = this.msgs[mi], a = m && m.actions && m.actions[ai]; if (!a || !CHAT_ACTIONS[a.type]) return;
    try { CHAT_ACTIONS[a.type](a); } catch (e) { toast("That item isn't available any more."); return; }
    if (a.type !== "chat" && window.innerWidth <= 760 && this.open) this.toggle();
  },
  clear() { if (!this.msgs.length) return; this.msgs = []; this.persist(); this.renderMsgs(); }
};

render();
