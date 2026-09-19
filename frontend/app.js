"use strict";
/* StudySync AI — runs fully in the browser. Data is saved in this browser only (localStorage). */
const $app = document.getElementById("app");
const KEY = "studysync_v2";
let db = loadDB();
const ui = { page: "dashboard", err: "", authTab: "login", draft: {}, analyzing: null, active: null, hist: "all", recovery: null };

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
function questionsFor(t, all) {
  const pool = [...new Set([...t.text ? topWords(t.text, 25) : [], ...all.filter(x => x.subjectId === t.subjectId && x.id !== t.id).flatMap(x => topWords(x.text, 10))])].filter(w => w.length >= 5);
  return shuffle(clozeItems(t)).slice(0, 5).map(c => {
    const d = shuffle(pool.filter(w => !w.startsWith(c.k) && !c.k.startsWith(w))).slice(0, 3);
    if (d.length < 1) return null;
    return { q: blank(c.s, c.k), options: shuffle([c.k, ...d]), answer: c.k };
  }).filter(Boolean);
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
async function handleFiles(subId, files) {
  const sub = subjectsRef().find(s => s.id === subId); if (!sub || !files.length) return;
  toast("Reading files…");
  for (const f of files) sub.files.push(await readFile(f));
  if (db.current) save(); render();
  const bad = sub.files.filter(f => f.status !== "ok").length;
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
  const W = t => (1 + Math.min(t.text.length / 2500, 1.5)) * (t.difficult ? 1.7 : 1) * (p.mult[t.id] || 1);
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
  const todo = u.plan.sessions.filter(s => s.status !== "done").sort((a, b) => (b.status !== "pending") - (a.status !== "pending") || (a.date || "z").localeCompare(b.date || "z"));
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

/* ---------- views ---------- */
const logo = () => `<div class="logo"><div class="logo-mark">S</div><span class="logo-text">StudySync AI</span></div>`;
const D = (k, def = "") => ui.draft[k] ?? def;

function render() {
  if (!db.current || !user()) return renderAuth();
  if (!user().profile) return renderProfile();
  markMissed();
  const u = user(), nav = [["dashboard", "⌂", "Dashboard"], ["study", "✦", "Study"], ["plan", "◫", "Study Plan"], ["materials", "▣", "Materials"], ["progress", "◒", "Progress"], ["history", "◷", "History"], ["settings", "⚙", "Settings"]];
  const titles = Object.fromEntries(nav.map(n => [n[0], n[2]]));
  $app.innerHTML = `<div class="app-shell"><aside class="sidebar">${logo()}<nav class="side-nav">${nav.map(n => `<button class="nav-item ${ui.page === n[0] ? "active" : ""}" data-act="go" data-v="${n[0]}"><span>${n[1]}</span><span class="nav-text">${n[2]}</span></button>`).join("")}</nav>
    <div class="sidebar-bottom"><button class="nav-item" data-act="logout"><span>⎋</span><span class="nav-text">Log out</span></button></div></aside>
    <main class="main"><header class="topbar"><b>${titles[ui.page]}</b><div class="top-actions"><span class="muted">@${esc(u.profile.username)}</span><div class="avatar">${esc(u.profile.name.charAt(0).toUpperCase())}</div></div></header>
    <div class="content">${pageHTML()}</div></main></div>`;
}
function pageHTML() {
  return ({ dashboard: dashboardHTML, study: studyHTML, plan: planHTML, materials: materialsHTML, progress: progressHTML, history: historyHTML, settings: settingsHTML })[ui.page]();
}
const head = (t, p, a = "") => `<div class="page-title"><div><h1>${t}</h1>${p ? `<p>${p}</p>` : ""}</div><div class="actions">${a}</div></div>`;

/* --- auth --- */
function renderAuth() {
  const login = ui.authTab === "login";
  $app.innerHTML = `<div class="auth-wrap"><div class="auth-card">${logo()}
    <div class="tabs"><button class="${login ? "active" : ""}" data-act="tab" data-v="login">I have an account</button><button class="${!login ? "active" : ""}" data-act="tab" data-v="signup">I'm new</button></div>
    <h1>${login ? "Welcome back" : "Create your account"}</h1><p class="sub">${login ? "Log in to continue studying." : "Sign up to build your study plan."}</p>
    ${ui.err ? `<div class="notice red mb">${esc(ui.err)}</div>` : ""}
    <div class="form-group"><label>Email</label><input id="a_email" class="input" type="email" placeholder="you@example.com" autocomplete="email" data-enter="${login ? "login" : "signup"}"></div>
    <div class="form-group"><label>Password</label><input id="a_pw" class="input" type="password" placeholder="••••••••" autocomplete="${login ? "current-password" : "new-password"}" data-enter="${login ? "login" : "signup"}"></div>
    ${login ? "" : `<div class="form-group"><label>Confirm password</label><input id="a_pw2" class="input" type="password" placeholder="••••••••" data-enter="signup"></div>`}
    <button class="btn btn-primary full" data-act="${login ? "login" : "signup"}">${login ? "Log in" : "Sign up"}</button>
    <p class="muted center mt">Accounts and study data are saved only in this browser.</p></div></div>`;
}

/* --- profile setup --- */
function subjectBlock(s, editable) {
  return `<div class="subject-card"><div class="card-header"><b>${esc(s.name)}</b><button class="btn btn-danger btn-sm" data-act="delSub" data-id="${s.id}">Remove</button></div>
    <div class="upload"><label>＋ Upload materials<input type="file" multiple hidden data-upload="${s.id}" accept=".pdf,.docx,.txt,.md,.csv,.html"></label><div class="muted small">PDF, Word, TXT, Markdown</div></div>
    ${s.files.map(f => `<div class="file"><span>📄</span><span class="grow">${esc(f.name)}</span>${statusBadge(f)}<button class="btn btn-ghost btn-sm" data-act="delFile" data-id="${s.id}" data-f="${f.id}">✕</button></div>`).join("")}
    <details><summary>Or paste notes / syllabus text</summary><textarea class="input mt-s" rows="4" placeholder="Paste text here…" data-sub="${s.id}" data-field="paste">${esc(s.paste || "")}</textarea></details></div>`;
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
    `<div class="card">${Object.keys(days).sort().map(d => `<div class="day-head"><span>${fmtDate(d)}${d === today() ? " · Today" : ""}</span><span class="muted">${fmtDur(days[d].reduce((a, s) => a + s.minutes, 0))}</span></div>${days[d].sort((a, b) => a.start - b.start).map(s => { const t = topicOf(s.topicId); return `<div class="row"><div class="row-time">${fmtTime(s.start)}<br>${fmtDur(s.minutes)}</div><div class="row-main"><strong>${esc(t ? t.title : "")}</strong><span class="muted">${esc(subName(s.subjectId))}</span></div>${t && t.difficult ? `<span class="badge b-red">Difficult</span>` : ""}<span class="badge ${s.type === "revision" ? "b-yellow" : "b-blue"}">${s.type === "revision" ? "Revision" : "Study"}</span>${s.status === "done" ? `<span class="badge b-green">Done</span>` : s.status === "missed" ? `<span class="badge b-red">Missed</span>` : ""}</div>`; }).join("")}`).join("") || `<div class="empty">No sessions.</div>`}</div>`;
}

/* --- materials --- */
function materialsHTML() {
  const u = user(), subs = u.profile.subjects;
  return head("Materials", "Your subjects, files and the topics found in them.") +
    `<div class="card mb"><div class="form-group" style="margin:0"><label>Add a subject</label><div class="actions"><input class="input" style="flex:1;min-width:180px" id="newSub" data-bind="newSub" data-enter="addSub" placeholder="Subject name" value="${esc(D("newSub"))}"><button class="btn btn-secondary" data-act="addSub">Add subject</button></div></div></div>` +
    subs.map(s => { const ts = u.topics.filter(t => t.subjectId === s.id); return subjectBlock(s) + (ts.length ? `<div class="card mb"><h3>Topics found in ${esc(s.name)}</h3>${ts.map(t => `<div class="row"><div class="row-main"><strong>${esc(t.title)}</strong></div>${t.difficult ? `<span class="badge b-red">Difficult</span>` : ""}</div>`).join("")}</div>` : ""); }).join("") +
    `<div class="notice">New material is used the next time you set up an exam (Settings → New exam).</div>`;
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
    ${t.text.trim() ? `<details><summary>Read the full material for this topic</summary><div class="rawtext">${esc(t.text.slice(0, 6000))}</div></details>` : ""}</div>
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
  const rows = u.topics.map(t => { const l = S.filter(x => x.topicId === t.id), d = l.filter(x => x.status === "done").length, m = l.filter(x => ["missed", "unscheduled"].includes(x.status)).length; return `<tr><td>${esc(t.title)}</td><td>${esc(subName(t.subjectId))}</td><td>${d}/${l.length}</td><td>${t.lastTest != null ? t.lastTest + "%" : "–"}</td><td>${m ? `<span class="badge b-red">Backlog</span>` : d === l.length && l.length ? `<span class="badge b-green">Done</span>` : `<span class="badge b-blue">In progress</span>`}</td></tr>`; }).join("");
  return head("Progress", "How you're doing and what's still pending.") +
    `<div class="grid grid-4 mb"><div class="card"><div class="muted">Plan completed</div><div class="stat">${st.pct}%</div></div><div class="card"><div class="muted">Time studied</div><div class="stat">${fmtDur(st.studied)}</div></div><div class="card"><div class="muted">Avg recall</div><div class="stat">${st.recall != null ? st.recall + "%" : "–"}</div></div><div class="card"><div class="muted">Avg test</div><div class="stat">${st.test != null ? st.test + "%" : "–"}</div></div></div>
    <div class="grid grid-2 mb"><div class="card"><h3>By subject</h3>${bySub}</div>
    <div class="card"><h3>Backlog</h3>${st.missed.length ? `<p class="muted mb">${st.missed.length} pending session(s) · ${fmtDur(st.missed.reduce((a, s) => a + s.minutes, 0))}. Pick how much extra time you can add and we'll re-plan the remaining days.</p><div class="actions"><button class="btn btn-secondary" data-act="recover" data-v="0">Same daily hours</button><button class="btn btn-secondary" data-act="recover" data-v="60">+1 hour/day</button><button class="btn btn-secondary" data-act="recover" data-v="120">+2 hours/day</button></div>` : `<div class="notice green">🎉 No backlog. You're on track.</div>`}</div></div>
    ${rv ? recoveryHTML(rv) : ""}
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
  tab(d) { ui.authTab = d.v; ui.err = ""; render(); },
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
    subs.push({ id: uid(), name: n, files: [], paste: "" }); ui.draft.newSub = ""; if (db.current) save(); render();
  },
  delSub(d) { if (!confirm("Remove this subject and its materials?")) return; const subs = subjectsRef(); subs.splice(subs.findIndex(s => s.id === d.id), 1); if (db.current) save(); render(); },
  delFile(d) { const s = subjectsRef().find(s => s.id === d.id); s.files = s.files.filter(f => f.id !== d.f); if (db.current) save(); render(); },
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
  recover(d) { ui.recovery = makeRecovery(+d.v); render(); },
  cancelRecovery() { ui.recovery = null; render(); },
  acceptRecovery() {
    const u = user(), rv = ui.recovery, done = u.plan.sessions.filter(s => s.status === "done");
    rv.left.forEach(s => { s.date = null; s.status = "unscheduled"; });
    u.plan.sessions = [...done, ...rv.placed, ...rv.left]; log("plan", { text: `Catch-up plan created (${rv.placed.length} sessions re-scheduled${rv.left.length ? ", " + rv.left.length + " didn't fit" : ""})` });
    ui.recovery = null; ui.active = null; save(); toast("Catch-up plan saved ✓"); render();
  },
  hist(d) { ui.hist = d.v; render(); }
};
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
  if (t.dataset.setting) { user().settings[t.dataset.setting] = +t.value; save(); toast("Saved"); }
});
render();
