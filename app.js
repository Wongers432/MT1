/* TapTrack web draft. Plain JS, no build step. All data stays in this browser (localStorage). */
'use strict';

// ---------- Constants ----------
const KEY = 'taptrack.v1';
const MAX_PENCE = 9999999; // £99,999.99
const FREE = { customCats: 3, flows: 5, jars: 1, limits: 1 };
const DEFAULT_CATS = [
  ['food', 'Food & Drink', '🍔', '#FF9500'],
  ['transport', 'Transport', '🚌', '#007AFF'],
  ['shopping', 'Shopping', '🛍️', '#FF2D55'],
  ['bills', 'Bills', '💡', '#5856D6'],
  ['health', 'Health', '💊', '#32D74B'],
  ['fun', 'Entertainment', '🎉', '#AF52DE'],
  ['other', 'Other', '✨', '#8E8E93'],
];
const SWATCHES = ['#FF9500', '#007AFF', '#FF2D55', '#5856D6', '#32D74B', '#AF52DE', '#5AC8FA', '#FF3B30', '#FFCC00', '#8E8E93'];
const DAY = 86400000;

// ---------- Helpers ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const gbp0 = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
const fmt = (p) => gbp.format(p / 100);
const fmt0 = (p) => (p % 100 === 0 ? gbp0.format(p / 100) : gbp.format(p / 100));
const toPence = (s) => { const n = parseFloat(String(s).replace(/[£,\s]/g, '')); return isFinite(n) ? Math.round(n * 100) : NaN; };
const penceStr = (p) => (p / 100).toFixed(2);
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dkey = (d) => { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / DAY);
const longDate = (d) => d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
const timeStr = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const haptic = () => { try { navigator.vibrate && navigator.vibrate(12); } catch (_) {} };
const localInputValue = (d) => { d = new Date(d); const o = d.getTimezoneOffset(); return new Date(d - o * 60000).toISOString().slice(0, 16); };

function periodBounds(type, ref = new Date(), offset = 0) {
  const d = startOfDay(ref);
  if (type === 'weekly' || type === 'week') {
    const s = addDays(d, -((d.getDay() + 6) % 7) + 7 * offset); // weeks start Monday
    return { start: s, end: addDays(s, 7) };
  }
  if (type === 'monthly' || type === 'month') {
    const s = new Date(d.getFullYear(), d.getMonth() + offset, 1);
    return { start: s, end: new Date(s.getFullYear(), s.getMonth() + 1, 1) };
  }
  const s = new Date(d.getFullYear() + offset, 0, 1);
  return { start: s, end: new Date(s.getFullYear() + 1, 0, 1) };
}

// ---------- State ----------
function freshState() {
  return {
    expenses: [], // {id, amount (pence), date (ISO UTC), note, merchant, categoryId, source}
    categories: DEFAULT_CATS.map(([id, name, emoji, color], i) => ({ id, name, emoji, color, sortOrder: i, isDefault: true, monthlyLimit: null })),
    budget: { period: 'monthly', weekly: 10000, monthly: 45000, includeBills: false },
    flows: [], // {id, kind, name, amount, cycle, nextDate (YYYY-MM-DD)}
    jars: [], // {id, name, emoji, target, saved, deadline}
    noSpend: [], // YYYY-MM-DD
    settings: { theme: 'dark', reminder: true, reminderTime: '20:00', billReminders: true, plus: false, onboarded: false, skipped: {}, lastPeriodStart: null, lastReminder: null, appIcon: 'Default' },
    pendingLeftover: null,
  };
}
let S;
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (_) { S = null; }
  const f = freshState();
  if (!S) S = f;
  for (const k of Object.keys(f)) if (S[k] === undefined) S[k] = f[k];
  S.settings = { ...f.settings, ...S.settings };
  S.budget = { ...f.budget, ...S.budget };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) { toast('Could not save in this browser'); } }

const ui = { spPeriod: 'week', spOffset: 0, spCat: 'all', spQuery: '', spDay: null, lastSafe: null };

// ---------- Lookups ----------
const cats = () => [...S.categories].sort((a, b) => a.sortOrder - b.sortOrder);
const cat = (id) => S.categories.find((c) => c.id === id) || S.categories.find((c) => c.id === 'other');
const isPlus = () => !!S.settings.plus;
const inRange = (e, r) => { const t = new Date(e.date); return t >= r.start && t < r.end; };
const sum = (arr) => arr.reduce((a, e) => a + e.amount, 0);
const byDateDesc = (a, b) => new Date(b.date) - new Date(a.date);

// ---------- Business rules ----------
function budgetAmount() { return S.budget.period === 'weekly' ? S.budget.weekly : S.budget.monthly; }

function monthlyEquivalent(f) { return f.cycle === 'yearly' ? Math.round(f.amount / 12) : f.amount; }

function billsDueIn(r) {
  // Outflows due in the period (used only when "Include bills in my budget" is on).
  let total = 0;
  for (const f of S.flows.filter((x) => x.kind === 'outflow')) {
    let d = fromKey(f.nextDate);
    // walk back to the first occurrence on or after period start
    while (d >= r.start) { const p = stepFlow(d, f.cycle, -1); if (p < r.start) break; d = p; }
    while (d < r.end) { if (d >= r.start) total += f.amount; d = stepFlow(d, f.cycle, 1); }
  }
  return total;
}
function stepFlow(d, cycle, n) {
  const day = d.getDate();
  const t = cycle === 'yearly' ? new Date(d.getFullYear() + n, d.getMonth(), 1) : new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return t;
}
function rollFlows() {
  const today = startOfDay(new Date());
  let changed = false;
  for (const f of S.flows) {
    let d = fromKey(f.nextDate);
    while (d < today) { d = stepFlow(d, f.cycle, 1); changed = true; }
    f.nextDate = dkey(d);
  }
  if (changed) save();
}

function budgetState(now = new Date()) {
  const r = periodBounds(S.budget.period, now);
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  let budget = budgetAmount();
  if (S.budget.includeBills) budget -= billsDueIn(r);
  const inPeriod = S.expenses.filter((e) => inRange(e, r));
  const spent = sum(inPeriod);
  const spentToday = sum(inPeriod.filter((e) => new Date(e.date) >= today && new Date(e.date) < tomorrow));
  const spentBefore = sum(inPeriod.filter((e) => new Date(e.date) < today));
  const daysLeft = Math.max(1, daysBetween(today, r.end)); // includes today
  const allowance = Math.max(0, Math.floor((budget - spentBefore) / daysLeft));
  const safe = allowance - spentToday;
  const pct = budget > 0 ? spent / budget : (spent > 0 ? 2 : 0);
  const status = pct > 1 || budget - spent < 0 ? 'over' : pct >= 0.8 ? 'near' : 'ok';
  return { r, budget, spent, spentToday, spentBefore, daysLeft, allowance, safe, pct, status, usedUp: budget - spentBefore <= 0 };
}
const STATUS = { ok: ['On track', 'var(--accent)', '✓'], near: ['Near limit', 'var(--warning)', '!'], over: ['Over budget', 'var(--negative)', '✕'] };

function streak() {
  const counted = new Set([...S.expenses.map((e) => dkey(e.date)), ...S.noSpend]);
  if (!counted.size) return 0;
  const earliest = [...counted].sort()[0];
  let d = startOfDay(new Date());
  if (!counted.has(dkey(d))) d = addDays(d, -1); // today isn't over yet
  let n = 0;
  const frozen = new Set();
  while (dkey(d) >= earliest) {
    const k = dkey(d);
    if (counted.has(k)) n++;
    else {
      const wk = dkey(periodBounds('weekly', d).start);
      if (frozen.has(wk) || n === 0) break; // one freeze per Mon–Sun week
      frozen.add(wk);
    }
    d = addDays(d, -1);
  }
  return n;
}

function bestGuessCategory() {
  const since = Date.now() - 30 * DAY;
  const hour = new Date().getHours();
  const score = {};
  for (const e of S.expenses) {
    const t = new Date(e.date);
    if (t.getTime() < since) continue;
    score[e.categoryId] = (score[e.categoryId] || 0) + (Math.abs(t.getHours() - hour) <= 1 ? 10 : 1);
  }
  const top = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  return top && S.categories.some((c) => c.id === top[0]) ? top[0] : cats()[0].id;
}

function categoryMonthSpend(catId) {
  const r = periodBounds('monthly');
  return sum(S.expenses.filter((e) => e.categoryId === catId && inRange(e, r)));
}

function checkPeriodRollover() {
  const r = periodBounds(S.budget.period);
  const startKey = dkey(r.start);
  const last = S.settings.lastPeriodStart;
  if (last && last !== startKey && S.jars.length) {
    const prev = periodBounds(S.budget.period, addDays(r.start, -1));
    const left = budgetAmount() - sum(S.expenses.filter((e) => inRange(e, prev)));
    if (left > 0) S.pendingLeftover = { amount: left, period: S.budget.period === 'weekly' ? 'last week' : 'last month' };
  }
  S.settings.lastPeriodStart = startKey;
  save();
}

// ---------- Mutations ----------
function addExpense(data) { S.expenses.push({ id: uid(), source: 'manual', merchant: null, ...data }); save(); }
function deleteExpense(id) {
  const i = S.expenses.findIndex((e) => e.id === id);
  if (i < 0) return;
  const [removed] = S.expenses.splice(i, 1);
  save(); render();
  toast(`Deleted ${fmt(removed.amount)}`, 'Undo', () => { S.expenses.push(removed); save(); render(); });
}

// ---------- Small render pieces ----------
function txRow(e, { swipe = true } = {}) {
  const c = cat(e.categoryId);
  const sub = [e.note || e.merchant, `${shortDate(e.date)} · ${timeStr(e.date)}`].filter(Boolean).join(' · ');
  const row = `<button class="row" data-action="edit-expense" data-id="${e.id}" aria-label="${esc(c.name)} ${fmt(e.amount)}${e.note ? ', ' + esc(e.note) : ''}. Tap to edit.">
      <span class="emoji-tile" style="background:${c.color}22">${c.emoji}</span>
      <span class="grow"><span class="title" style="display:block">${esc(c.name)}</span><span class="sub" style="display:block">${esc(sub)}</span></span>
      <span class="amt">−${fmt(e.amount)}</span></button>`;
  return swipe ? `<div class="swipe" data-swipe="${e.id}"><div class="del-bg" aria-hidden="true">Delete</div>${row}</div>` : row;
}
function ringSVG(pct, color, size = 96) {
  const r = 40, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, Math.max(0, pct)));
  return `<svg class="ring" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="${Math.round(pct * 100)} percent of budget used">
    <circle class="track" cx="50" cy="50" r="${r}"/><circle class="val" cx="50" cy="50" r="${r}" stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${off}"/></svg>`;
}
function progress(pct, color) {
  return `<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct * 100)}"><div style="width:${Math.min(100, pct * 100)}%;background:${color}"></div></div>`;
}
const limitColor = (p) => (p >= 1 ? 'var(--negative)' : p >= 0.8 ? 'var(--warning)' : 'var(--accent)');
const icon = { gear: '⚙︎', chev: '›' };

// ---------- Views ----------
function viewToday() {
  const now = new Date();
  const b = budgetState(now);
  const [pill, color, mark] = STATUS[b.status];
  const hero = b.usedUp
    ? `<div class="amount num neg" data-hero="0">${fmt(0)}</div>`
    : b.safe < 0
      ? `<div class="amount num neg" style="font-size:40px">${fmt(-b.safe)} over today</div>`
      : `<div class="amount num" data-hero="${b.safe}">${fmt(b.safe)}</div>`;
  const recent = [...S.expenses].sort(byDateDesc).slice(0, 5);
  const st = streak();
  const loggedToday = S.expenses.some((e) => dkey(e.date) === dkey(now)) || S.noSpend.includes(dkey(now));
  return `
  <div class="topbar"><div><div class="date">${longDate(now)}</div><h1>Today</h1></div>
    <button class="icon-btn" data-route="settings" aria-label="Settings">${icon.gear}</button></div>
  <section class="card hero" aria-label="Safe to spend today">
    <div class="label">Safe to spend today</div>
    ${hero}
    <span class="pill ${b.status}" role="status"><span aria-hidden="true">${mark}</span>${b.usedUp ? 'Over budget' : pill}</span>
  </section>
  <section class="card">
    <div class="ring-wrap">
      ${ringSVG(b.pct, color)}
      <div class="ring-text">
        <strong class="num">${fmt0(b.spent)} <span class="muted" style="font-weight:400;font-size:17px">of ${fmt0(b.budget)}</span></strong>
        <span class="muted">${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'} left this ${S.budget.period === 'weekly' ? 'week' : 'month'}</span><br>
        ${st > 0 ? `<span class="streak" aria-label="${st} day streak">🔥 ${st} day${st === 1 ? '' : 's'}</span>` : `<span class="streak">🔥 Start a streak</span>`}
      </div>
    </div>
  </section>
  ${nudge()}
  <div class="section-head"><h2>Recent Transactions</h2>${S.expenses.length ? '<button class="link" data-route="spending">See all</button>' : ''}</div>
  ${recent.length
    ? `<div class="list">${recent.map((e) => txRow(e)).join('')}</div>${!loggedToday ? '<button class="btn btn-ghost" data-action="no-spend">✓ No spend today</button>' : ''}`
    : `<div class="card empty"><div class="big">🧾</div>No transactions yet. Add your first expense to get started!<div style="margin-top:14px">Tap <b style="color:var(--accent)">+</b> below ↓</div>
       <div style="margin-top:16px"><button class="btn-sm" data-action="no-spend">✓ No spend today</button></div></div>`}
  <p class="web-note">Swipe left on a transaction to delete it.</p>`;
}

function nudge() {
  const today = startOfDay(new Date());
  const tomorrow = dkey(addDays(today, 1));
  let n = null;
  if (S.pendingLeftover && S.jars.length) {
    const jar = S.jars[0];
    n = { emoji: '🫙', title: `Move ${fmt(S.pendingLeftover.amount)} left over into ${jar.emoji} ${esc(jar.name)}?`, sub: `You came in under budget ${S.pendingLeftover.period}.`, action: 'move-leftover', btn: 'Move', dismiss: 'dismiss-leftover' };
  } else {
    const due = S.flows.find((f) => f.kind === 'outflow' && f.nextDate === tomorrow);
    const hot = cats().find((c) => c.monthlyLimit && categoryMonthSpend(c.id) >= 0.8 * c.monthlyLimit);
    if (due) n = { emoji: '📅', title: `${esc(due.name)} is due tomorrow`, sub: `${fmt(due.amount)} goes out ${shortDate(fromKey(due.nextDate))}.`, route: 'plan', btn: 'View' };
    else if (hot) {
      const p = categoryMonthSpend(hot.id) / hot.monthlyLimit;
      n = { emoji: hot.emoji, title: `${esc(hot.name)} is at ${Math.round(p * 100)}% of its limit`, sub: `${fmt(categoryMonthSpend(hot.id))} of ${fmt(hot.monthlyLimit)} this month.`, route: 'goals', btn: 'View' };
    } else if (S.settings.skipped.backTap) n = { emoji: '👆', title: 'Set up Back Tap', sub: 'Double-tap the back of your iPhone to log a spend.', action: 'backtap-info', btn: 'Set up', dismiss: 'dismiss-backtap' };
  }
  if (!n) return '';
  return `<section class="card insight" aria-label="Suggestion"><span style="font-size:26px">${n.emoji}</span>
    <div class="grow"><div style="font-weight:600">${n.title}</div><div class="muted small">${n.sub}</div></div>
    <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
      <button class="btn-sm" ${n.action ? `data-action="${n.action}"` : `data-route="${n.route}"`}>${n.btn}</button>
      ${n.dismiss ? `<button class="small muted" data-action="${n.dismiss}" style="padding:4px">Not now</button>` : ''}</div></section>`;
}

function spendingRange() {
  return periodBounds(ui.spPeriod, new Date(), ui.spOffset);
}
function spendingLabel(r) {
  if (ui.spPeriod === 'week') return ui.spOffset === 0 ? 'This week' : `${shortDate(r.start)} – ${shortDate(addDays(r.end, -1))}`;
  if (ui.spPeriod === 'month') return r.start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return String(r.start.getFullYear());
}
function viewSpending() {
  const r = spendingRange();
  const all = S.expenses.filter((e) => inRange(e, r));
  const total = sum(all);
  // daily (or monthly) buckets
  const buckets = [];
  if (ui.spPeriod === 'year') for (let m = 0; m < 12; m++) {
    const s = new Date(r.start.getFullYear(), m, 1), e = new Date(r.start.getFullYear(), m + 1, 1);
    buckets.push({ key: `m${m}`, s, e, lbl: s.toLocaleDateString('en-GB', { month: 'narrow' }) });
  } else for (let d = r.start; d < r.end; d = addDays(d, 1)) {
    const lbl = ui.spPeriod === 'week' ? d.toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2) : (d.getDate() === 1 || d.getDate() % 5 === 0 ? d.getDate() : '');
    buckets.push({ key: dkey(d), s: d, e: addDays(d, 1), lbl });
  }
  buckets.forEach((b) => (b.v = sum(all.filter((x) => { const t = new Date(x.date); return t >= b.s && t < b.e; }))));
  const max = Math.max(1, ...buckets.map((b) => b.v));
  const top = buckets.reduce((a, b) => (b.v > a.v ? b : a), buckets[0]);
  const byCat = cats().map((c) => ({ c, v: sum(all.filter((e) => e.categoryId === c.id)) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const emptyMsg = { week: 'Nothing logged this week yet', month: 'Nothing logged this month yet', year: 'Nothing logged this year yet' }[ui.spPeriod];
  const prevLocked = !isPlus();
  return `
  <div class="topbar"><h1>Spending</h1></div>
  <div class="seg" role="tablist">${['week', 'month', 'year'].map((p) => `<button role="tab" aria-selected="${ui.spPeriod === p}" class="${ui.spPeriod === p ? 'on' : ''}" data-action="sp-period" data-v="${p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
  <section class="card">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <button class="icon-btn" data-action="sp-prev" aria-label="Previous period${prevLocked ? ' (Plus)' : ''}">‹${prevLocked ? '<span style="font-size:10px">🔒</span>' : ''}</button>
      <div style="text-align:center"><div class="muted small">${spendingLabel(r)}</div><div class="num" style="font-size:28px;font-weight:600">${fmt(total)}</div></div>
      <button class="icon-btn" data-action="sp-next" aria-label="Next period" ${ui.spOffset >= 0 ? 'disabled style="opacity:.3"' : ''}>›</button>
    </div>
    <div class="bars" role="img" aria-label="${esc(`Spending by ${ui.spPeriod === 'year' ? 'month' : 'day'}: total ${fmt(total)}${top && top.v ? `, highest ${fmt(top.v)}` : ''}`)}">
      ${buckets.map((b) => `<button class="${b.v ? '' : 'zero'} ${ui.spDay === b.key ? 'sel' : ''}" data-action="sp-day" data-v="${b.key}" aria-label="${fmt(b.v)}"><span class="b" style="height:${(b.v / max) * 100}%"></span><span class="lbl">${b.lbl}</span></button>`).join('')}
    </div>
  </section>
  ${byCat.length ? `<section class="card" aria-label="Category breakdown"><h2>By category</h2>
    ${byCat.map(({ c, v }) => `<div class="hbar"><div class="top"><span>${c.emoji} ${esc(c.name)}</span><span class="num">${fmt(v)} <span class="muted small">${Math.round((v / total) * 100)}%</span></span></div>${progress(v / byCat[0].v, c.color)}</div>`).join('')}
  </section>` : ''}
  <div class="section-head"><h2>Transactions</h2>${ui.spDay ? '<button class="link" data-action="sp-day" data-v="">Clear day</button>' : ''}</div>
  <input class="search" type="search" placeholder="Search notes and merchants" value="${esc(ui.spQuery)}" data-input="sp-query" aria-label="Search notes and merchants">
  <div class="chips">${[['all', 'All']].concat(cats().map((c) => [c.id, `${c.emoji} ${c.name}`])).map(([id, l]) => `<button class="chip ${ui.spCat === id ? 'on' : ''}" data-action="sp-cat" data-v="${id}">${esc(l)}</button>`).join('')}</div>
  <div id="sp-list">${spendingList(all, buckets, emptyMsg)}</div>`;
}
function spendingList(all, buckets, emptyMsg) {
  let list = all;
  if (ui.spDay) { const b = buckets.find((x) => x.key === ui.spDay); if (b) list = list.filter((x) => { const t = new Date(x.date); return t >= b.s && t < b.e; }); }
  if (ui.spCat !== 'all') list = list.filter((e) => e.categoryId === ui.spCat);
  const q = ui.spQuery.trim().toLowerCase();
  if (q) list = list.filter((e) => `${e.note || ''} ${e.merchant || ''}`.toLowerCase().includes(q));
  if (!list.length) return `<div class="card empty"><div class="big">🗓️</div>${all.length ? 'No matching transactions' : emptyMsg}</div>`;
  const groups = {};
  list.sort(byDateDesc).forEach((e) => (groups[dkey(e.date)] ||= []).push(e));
  return Object.entries(groups).map(([k, es]) => `<div class="day-head"><span>${longDate(fromKey(k))}</span><span class="num">${fmt(sum(es))}</span></div><div class="list">${es.map((e) => txRow(e)).join('')}</div>`).join('');
}

function viewGoals() {
  const limits = cats().filter((c) => c.monthlyLimit);
  const empty = !S.jars.length && !limits.length;
  return `
  <div class="topbar"><h1>Goals</h1></div>
  ${empty ? `<section class="card empty"><div class="big">🎯</div><div style="font-weight:600;color:var(--text);font-size:20px">Set your first goal</div>
      <p style="margin:6px 0 16px">Save towards something, or cap a category each month.</p>
      <button class="btn btn-primary" data-action="jar-new">Add a savings jar</button><button class="btn btn-ghost" data-action="limit-new">Add a category limit</button></section>` : `
  <div class="section-head"><h2>Savings jars</h2><button class="link" data-action="jar-new">+ Add jar</button></div>
  ${S.jars.length ? S.jars.map((j, i) => {
    const p = j.target ? j.saved / j.target : 0;
    const ro = !isPlus() && i >= FREE.jars;
    return `<button class="card jar" style="width:100%;text-align:left" data-action="jar-open" data-id="${j.id}">
      <span class="emoji-tile" style="background:var(--surface2);width:52px;height:52px;font-size:26px">${j.emoji}</span>
      <span class="meta"><span style="display:flex;justify-content:space-between"><b>${esc(j.name)}</b>${ro ? '<span class="badge">Read-only</span>' : p >= 1 ? '<span class="badge">Done 🎉</span>' : ''}</span>
      <span class="muted small" style="display:block;margin:2px 0 8px"><span class="num">${fmt(j.saved)} of ${fmt(j.target)}</span>${j.deadline ? ` · by ${shortDate(fromKey(j.deadline))}` : ''}</span>
      ${progress(p, 'var(--positive)')}</span></button>`;
  }).join('') : '<div class="card muted">No jars yet.</div>'}
  <div class="section-head"><h2>Category limits</h2><button class="link" data-action="limit-new">+ Add limit</button></div>
  ${limits.length ? `<div class="card">${limits.map((c) => {
    const s = categoryMonthSpend(c.id), p = s / c.monthlyLimit;
    return `<button class="hbar" style="display:block;width:100%;text-align:left" data-action="limit-open" data-id="${c.id}"><div class="top"><span>${c.emoji} ${esc(c.name)}</span><span class="num ${p >= 1 ? 'neg' : p >= 0.8 ? 'warn' : ''}">${fmt(s)} / ${fmt(c.monthlyLimit)}${p >= 1 ? ' · Over' : p >= 0.8 ? ' · Near' : ''}</span></div>${progress(p, limitColor(p))}</button>`;
  }).join('')}</div>` : '<div class="card muted">No limits yet.</div>'}`}
  <p class="web-note">Jar money is a number you track. TapTrack never moves real money.</p>`;
}

function viewPlan() {
  const ins = S.flows.filter((f) => f.kind === 'inflow');
  const outs = S.flows.filter((f) => f.kind === 'outflow');
  const income = ins.reduce((a, f) => a + monthlyEquivalent(f), 0);
  const committed = outs.reduce((a, f) => a + monthlyEquivalent(f), 0);
  const flowRow = (f) => {
    const ro = !isPlus() && S.flows.indexOf(f) >= FREE.flows;
    return `<button class="row" data-action="flow-open" data-id="${f.id}">
      <span class="emoji-tile" style="background:${f.kind === 'inflow' ? '#30D15822' : '#FF453A22'}">${f.kind === 'inflow' ? '💰' : '🔁'}</span>
      <span class="grow"><span class="title" style="display:block">${esc(f.name)}${ro ? ' <span class="badge">Read-only</span>' : ''}</span><span class="sub" style="display:block">${f.cycle === 'yearly' ? 'Yearly' : 'Monthly'} · next ${shortDate(fromKey(f.nextDate))}</span></span>
      <span class="amt ${f.kind === 'inflow' ? 'pos' : ''}">${f.kind === 'inflow' ? '+' : '−'}${fmt(f.amount)}</span></button>`;
  };
  return `
  <div class="topbar"><h1>Plan</h1></div>
  <section class="card"><div style="display:flex;justify-content:space-between;align-items:center">
    <div><div class="muted small">${S.budget.period === 'weekly' ? 'Weekly' : 'Monthly'} budget</div><div class="num" style="font-size:28px;font-weight:600">${fmt(budgetAmount())}</div>
    <div class="muted small">${S.budget.includeBills ? 'Bills are included in this budget' : 'For day-to-day spending'}</div></div>
    <button class="btn-sm" data-action="budget-edit">Edit</button></div></section>
  <section class="card" style="background:linear-gradient(135deg,var(--accent),var(--accent-deep));color:#fff">
    <div style="opacity:.8" class="small">Month's effective balance</div>
    <div class="num" style="font-size:34px;font-weight:600">${income - committed < 0 ? '−' : ''}${fmt(Math.abs(income - committed))}</div>
    <div class="small" style="opacity:.8">${fmt(income)} in − ${fmt(committed)} fixed out</div></section>
  <div class="section-head"><h2>Inflows</h2><button class="link" data-action="flow-new" data-v="inflow">+ Add</button></div>
  <p class="muted small" style="margin:-4px 4px 10px">All money coming in — salary, freelance, and other income</p>
  ${ins.length ? `<div class="list">${ins.map(flowRow).join('')}</div>` : '<div class="card muted small">No inflows yet.</div>'}
  <div class="section-head"><h2>Outflows</h2><button class="link" data-action="flow-new" data-v="outflow">+ Add</button></div>
  <p class="muted small" style="margin:-4px 4px 10px">Regular subscriptions and fixed costs like rent or Netflix</p>
  ${outs.length ? `<div class="list">${outs.map(flowRow).join('')}</div>` : '<div class="card muted small">No outflows yet.</div>'}
  <section class="card" style="display:flex;justify-content:space-between;align-items:center"><span>Monthly Committed</span><b class="num">${fmt(committed)}</b></section>
  ${!isPlus() ? `<p class="web-note">${S.flows.length} of ${FREE.flows} flows on Free</p>` : ''}`;
}

function setRow({ tile, color, label, value = '', action, route, chev = true, extra = '' }) {
  const attr = action ? `data-action="${action}"` : route ? `data-route="${route}"` : '';
  const tag = attr ? 'button' : 'div';
  return `<${tag} class="row" ${attr} ${extra}><span class="set-tile" style="background:${color}">${tile}</span><span class="grow title">${label}</span><span class="muted">${value}</span>${chev && attr ? `<span class="chev">${icon.chev}</span>` : ''}</${tag}>`;
}
function viewSettings() {
  const s = S.settings;
  return `
  <button class="back" data-route="today">‹ Today</button>
  <div class="topbar"><h1>Settings</h1></div>
  <section class="card" style="${isPlus() ? '' : 'background:linear-gradient(135deg,var(--accent),var(--accent-deep));color:#fff'}">
    <div style="display:flex;gap:12px;align-items:center"><span style="font-size:30px">${isPlus() ? '⭐️' : '✨'}</span>
    <div style="flex:1"><b>${isPlus() ? 'TapTrack Plus is on' : 'TapTrack Plus'}</b><div class="small" style="opacity:.85">${isPlus() ? 'Demo mode in this browser' : 'Auto-log Apple Pay, unlimited goals and full history'}</div></div>
    <button class="btn-sm" style="${isPlus() ? '' : 'background:#fff;color:var(--accent)'}" data-action="${isPlus() ? 'plus-off' : 'paywall'}">${isPlus() ? 'Turn off' : 'Try free'}</button></div></section>

  <div class="day-head">Quick capture</div>
  <div class="list">
    ${setRow({ tile: '👆', color: '#007AFF', label: 'Back Tap', action: 'backtap-info' })}
    ${setRow({ tile: '', color: '#34C759', label: 'Apple Pay auto-log', value: isPlus() ? '' : 'Plus', action: 'applepay-info' })}
    ${setRow({ tile: '◉', color: '#FF9500', label: 'Action Button & Siri', action: 'action-info' })}
    ${setRow({ tile: '▦', color: '#5AC8FA', label: 'Widgets & Control Center', action: 'widget-info' })}
  </div>

  <div class="day-head">Appearance</div>
  <div class="card" style="padding:12px">
    <div class="seg" style="margin:0;background:var(--surface2)">${['system', 'dark', 'light'].map((t) => `<button class="${s.theme === t ? 'on' : ''}" data-action="theme" data-v="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
  </div>
  <div class="list">${setRow({ tile: '🎨', color: '#AF52DE', label: 'App icon', value: esc(s.appIcon), action: 'app-icon' })}</div>

  <div class="day-head">Budgeting</div>
  <div class="list">
    ${setRow({ tile: '📅', color: '#5856D6', label: 'Budget period', value: S.budget.period === 'weekly' ? 'Weekly' : 'Monthly', action: 'budget-edit' })}
    ${setRow({ tile: '£', color: '#007AFF', label: 'Weekly budget', value: fmt(S.budget.weekly), action: 'budget-edit' })}
    ${setRow({ tile: '£', color: '#0057FF', label: 'Monthly budget', value: fmt(S.budget.monthly), action: 'budget-edit' })}
    <label class="row"><span class="set-tile" style="background:#FF3B30">🧾</span><span class="grow title">Include bills in my budget</span><input type="checkbox" class="toggle" data-toggle="includeBills" ${S.budget.includeBills ? 'checked' : ''}></label>
    ${setRow({ tile: '🏷️', color: '#FF9500', label: 'Manage Categories', value: String(S.categories.length), route: 'categories' })}
  </div>

  <div class="day-head">Reminders</div>
  <div class="list">
    <label class="row"><span class="set-tile" style="background:#FF3B30">🔔</span><span class="grow title">Daily Reminder</span><input type="checkbox" class="toggle" data-toggle="reminder" ${s.reminder ? 'checked' : ''}></label>
    ${s.reminder ? `<label class="row"><span class="set-tile" style="background:#8E8E93">⏰</span><span class="grow title">Reminder time</span><input type="time" class="input" style="width:auto;min-height:40px;padding:6px 10px" value="${s.reminderTime}" data-input="reminder-time"></label>` : ''}
    <label class="row"><span class="set-tile" style="background:#5856D6">📆</span><span class="grow title">Bill due tomorrow</span><input type="checkbox" class="toggle" data-toggle="billReminders" ${s.billReminders ? 'checked' : ''}></label>
  </div>
  <p class="muted small" style="margin:6px 6px 0">Sent at your time only if nothing was logged that day. On the web this needs notifications allowed and the page open.</p>

  <div class="day-head">Data</div>
  <div class="list">
    ${setRow({ tile: '☁️', color: '#5AC8FA', label: 'iCloud sync', value: 'In the app', action: 'icloud-info' })}
    ${setRow({ tile: '⇪', color: '#34C759', label: 'Export Data (CSV)', action: 'export' })}
    ${setRow({ tile: '🧪', color: '#AF52DE', label: 'Load sample data', action: 'sample' })}
    ${setRow({ tile: '↺', color: '#007AFF', label: 'Replay onboarding', action: 'onboard' })}
    ${setRow({ tile: '⚠︎', color: '#FF3B30', label: '<span class="neg">Reset All Data</span>', action: 'reset' })}
  </div>

  <div class="day-head">About</div>
  <div class="list">
    ${setRow({ tile: '🔒', color: '#8E8E93', label: 'Privacy policy', action: 'privacy' })}
    ${setRow({ tile: '📄', color: '#8E8E93', label: 'Terms of use', action: 'terms' })}
  </div>
  <p class="web-note">TapTrack v1.0.0 · web draft<br>TapTrack helps you track your own spending. It does not provide financial advice.</p>`;
}

function viewCategories() {
  const list = cats();
  return `
  <button class="back" data-route="settings">‹ Settings</button>
  <div class="topbar"><h1>Categories</h1><button class="btn-sm" data-action="cat-new">+ Add</button></div>
  <div class="list">${list.map((c, i) => `<div class="row">
    <span class="emoji-tile" style="background:${c.color}">${c.emoji}</span>
    <button class="grow title" style="text-align:left;min-height:44px" data-action="cat-open" data-id="${c.id}">${esc(c.name)} ${c.isDefault ? '' : '<span class="badge">Custom</span>'}</button>
    <button class="icon-btn" data-action="cat-move" data-id="${c.id}" data-v="-1" aria-label="Move ${esc(c.name)} up" ${i === 0 ? 'disabled style="opacity:.25"' : ''}>↑</button>
    <button class="icon-btn" data-action="cat-move" data-id="${c.id}" data-v="1" aria-label="Move ${esc(c.name)} down" ${i === list.length - 1 ? 'disabled style="opacity:.25"' : ''}>↓</button></div>`).join('')}</div>
  <p class="web-note">${isPlus() ? 'Unlimited custom categories with Plus.' : `${S.categories.filter((c) => !c.isDefault).length} of ${FREE.customCats} custom categories on Free.`} Deleting a category moves its expenses to Other.</p>`;
}

// ---------- Layer: sheets, full screens, toasts ----------
let sheetCleanup = null;
function openSheet(title, body, onMount) {
  closeSheet();
  const layer = $('#layer');
  layer.innerHTML = `<div class="overlay" data-close="1"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="grab" aria-hidden="true"></div><div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-action="close" aria-label="Close">✕</button></div>${body}</div></div>`;
  sheetCleanup = onMount ? onMount($('.sheet', layer)) : null;
  const first = $('.sheet input:not([type=hidden]), .sheet button:not(.icon-btn)', layer);
  if (first && first.dataset.noautofocus === undefined) setTimeout(() => first.focus({ preventScroll: true }), 50);
}
function openFull(html, onMount) {
  closeSheet();
  $('#layer').innerHTML = `<div class="full" role="dialog" aria-modal="true"><div class="inner">${html}</div></div>`;
  sheetCleanup = onMount ? onMount($('.full .inner')) : null;
}
function closeSheet() {
  if (typeof sheetCleanup === 'function') sheetCleanup();
  sheetCleanup = null;
  $('#layer').innerHTML = '';
}
let toastTimer;
function toast(msg, actionLabel, onAction) {
  $('.toast')?.remove();
  clearTimeout(toastTimer);
  const t = document.createElement('div');
  t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span>${actionLabel ? `<button>${esc(actionLabel)}</button>` : ''}`;
  if (actionLabel) t.querySelector('button').onclick = () => { t.remove(); onAction(); };
  document.body.appendChild(t);
  toastTimer = setTimeout(() => t.remove(), 5000);
}
function confetti() {
  if (reduceMotion()) return;
  const colors = ['#0057FF', '#32D74B', '#FF9500', '#FF2D55', '#AF52DE', '#FFCC00'];
  for (let i = 0; i < 60; i++) {
    const c = document.createElement('i');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.animationDuration = 1.4 + Math.random() + 's';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 2800);
  }
}
function upsell(what) { toast(`${what} is part of TapTrack Plus`); openPaywall(); }

// ---------- Quick log sheet ----------
function openQuickLog(id) {
  const ex = id ? S.expenses.find((e) => e.id === id) : null;
  let amount = ex ? penceStr(ex.amount).replace(/\.00$/, '') : '';
  let catId = ex ? ex.categoryId : bestGuessCategory();
  const body = `
    <div class="amount-display num" aria-live="polite"><span class="cur">£</span><span id="ql-amt">0</span></div>
    <div id="ql-err" class="neg small" style="text-align:center;min-height:18px"></div>
    <div class="keypad" aria-label="Amount keypad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => `<button data-k="${k}" aria-label="${k === '⌫' ? 'Delete digit' : k}">${k}</button>`).join('')}</div>
    <label class="f">Category</label>
    <div class="bubbles" role="radiogroup">${cats().map((c) => `<button class="bubble" role="radio" data-cat="${c.id}"><span class="dot" style="background:${c.color}">${c.emoji}</span><span>${esc(c.name)}</span></button>`).join('')}</div>
    <label class="f" for="ql-note">Note (Optional)</label>
    <input class="input" id="ql-note" maxlength="80" placeholder="e.g. Flat white at Pret" value="${esc(ex?.note || '')}" data-noautofocus>
    <label class="f" for="ql-date">Date</label>
    <input class="input" id="ql-date" type="datetime-local" value="${localInputValue(ex ? ex.date : new Date())}" max="${localInputValue(new Date())}">
    <div style="margin-top:20px"><button class="btn btn-primary" id="ql-save">Save Expense</button>${ex ? '<button class="btn btn-danger" id="ql-del">Delete</button>' : ''}</div>`;
  openSheet(ex ? 'Edit Expense' : 'Log Expense', body, (root) => {
    const amtEl = $('#ql-amt', root);
    const paint = () => {
      amtEl.textContent = amount || '0';
      amtEl.style.color = amount ? '' : 'var(--text2)';
      $$('.bubble', root).forEach((b) => { const on = b.dataset.cat === catId; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    };
    const press = (k) => {
      $('#ql-err', root).textContent = '';
      if (k === '⌫' || k === 'Backspace') amount = amount.slice(0, -1);
      else if (k === '.') { if (!amount.includes('.')) amount = (amount || '0') + '.'; }
      else if (/^\d$/.test(k)) {
        if (amount.includes('.') && amount.split('.')[1].length >= 2) return;
        if (!amount.includes('.') && amount.replace(/^0/, '').length >= 5) return;
        amount = amount === '0' ? k : amount + k;
      }
      paint();
    };
    $$('.keypad button', root).forEach((b) => (b.onclick = () => press(b.dataset.k)));
    $$('.bubble', root).forEach((b) => (b.onclick = () => { catId = b.dataset.cat; paint(); }));
    const onKey = (e) => {
      if (document.activeElement && document.activeElement.matches('input')) { if (e.key === 'Enter') { e.preventDefault(); doSave(); } return; }
      if (/^[\d.]$/.test(e.key) || e.key === 'Backspace') { e.preventDefault(); press(e.key); }
      if (e.key === 'Enter') { e.preventDefault(); doSave(); }
    };
    const doSave = () => {
      const p = toPence(amount);
      if (!amount || !p) { $('#ql-err', root).textContent = 'Enter an amount'; if (!ex) return; return; }
      if (p > MAX_PENCE) { $('#ql-err', root).textContent = 'Max £99,999.99'; return; }
      let when = new Date($('#ql-date', root).value || Date.now());
      if (isNaN(when) || when > new Date()) when = new Date();
      const note = $('#ql-note', root).value.trim() || null;
      const before = budgetState().safe;
      if (ex) Object.assign(ex, { amount: p, categoryId: catId, note, date: when.toISOString() }), save();
      else addExpense({ amount: p, categoryId: catId, note, date: when.toISOString() });
      haptic();
      closeSheet();
      ui.lastSafe = before;
      render();
      const b = budgetState(), c = cat(catId);
      toast(`${fmt(p)} · ${c.emoji} ${c.name} · ${b.safe >= 0 ? fmt(b.safe) + ' left today' : fmt(-b.safe) + ' over today'}`);
    };
    $('#ql-save', root).onclick = doSave;
    if (ex) $('#ql-del', root).onclick = () => { closeSheet(); deleteExpense(ex.id); };
    document.addEventListener('keydown', onKey);
    paint();
    return () => document.removeEventListener('keydown', onKey);
  });
}

// ---------- Other sheets ----------
function segHTML(name, options, value) {
  return `<div class="seg" data-seg="${name}" style="margin:0">${options.map(([v, l]) => `<button type="button" class="${v === value ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;
}
function wireSeg(root, name, onChange) {
  const seg = $(`[data-seg="${name}"]`, root);
  $$('button', seg).forEach((b) => (b.onclick = () => { $$('button', seg).forEach((x) => x.classList.toggle('on', x === b)); onChange(b.dataset.v); }));
}

function openBudget() {
  let period = S.budget.period;
  openSheet('Budget', `
    <label class="f">Period</label>${segHTML('period', [['weekly', 'Weekly'], ['monthly', 'Monthly']], period)}
    <label class="f" for="b-week">Weekly budget (£)</label><input class="input num" id="b-week" inputmode="decimal" value="${penceStr(S.budget.weekly)}">
    <label class="f" for="b-month">Monthly budget (£)</label><input class="input num" id="b-month" inputmode="decimal" value="${penceStr(S.budget.monthly)}">
    <label class="row" style="padding:16px 4px"><span class="grow">Include bills in my budget<div class="muted small">Subtracts outflows due this period</div></span><input type="checkbox" class="toggle" id="b-bills" ${S.budget.includeBills ? 'checked' : ''}></label>
    <p class="muted small">Weeks run Monday to Sunday. Months run on calendar months. Changes apply to the current period straight away.</p>
    <div style="margin-top:16px"><button class="btn btn-primary" id="b-save">Save</button></div>`, (root) => {
    wireSeg(root, 'period', (v) => (period = v));
    $('#b-save', root).onclick = () => {
      const w = toPence($('#b-week', root).value), m = toPence($('#b-month', root).value);
      if (!(w > 0) || !(m > 0) || w > MAX_PENCE || m > MAX_PENCE) return toast('Enter budgets between £0.01 and £99,999.99');
      Object.assign(S.budget, { period, weekly: w, monthly: m, includeBills: $('#b-bills', root).checked });
      S.settings.lastPeriodStart = dkey(periodBounds(period).start);
      save(); closeSheet(); render(); toast('Budget updated');
    };
  });
}

function openFlow(id, kind = 'outflow') {
  const f = id ? S.flows.find((x) => x.id === id) : null;
  if (!f && !isPlus() && S.flows.length >= FREE.flows) return upsell('More than 5 flows');
  const ro = f && !isPlus() && S.flows.indexOf(f) >= FREE.flows;
  let cycle = f?.cycle || 'monthly';
  kind = f?.kind || kind;
  openSheet(f ? 'Edit Flow' : kind === 'inflow' ? 'Add Inflow' : 'Add Outflow', `
    ${ro ? '<p class="badge" style="margin-bottom:8px">Read-only on Free. Your data is kept.</p>' : ''}
    <label class="f" for="f-name">Description</label><input class="input" id="f-name" maxlength="40" placeholder="${kind === 'inflow' ? 'e.g. Salary' : 'e.g. Rent or Netflix'}" value="${esc(f?.name || '')}">
    <label class="f" for="f-amt">Amount (£)</label><input class="input num" id="f-amt" inputmode="decimal" placeholder="0.00" value="${f ? penceStr(f.amount) : ''}">
    <label class="f">Billing Cycle</label>${segHTML('cycle', [['monthly', 'Monthly'], ['yearly', 'Yearly']], cycle)}
    <label class="f" for="f-date">Next Date</label><input class="input" id="f-date" type="date" value="${f?.nextDate || dkey(new Date())}">
    <div style="margin-top:20px">${ro ? '' : '<button class="btn btn-primary" id="f-save">Save Flow</button>'}${f ? '<button class="btn btn-danger" id="f-del">Delete</button>' : ''}</div>`, (root) => {
    wireSeg(root, 'cycle', (v) => (cycle = v));
    if (!ro) $('#f-save', root).onclick = () => {
      const name = $('#f-name', root).value.trim(), amt = toPence($('#f-amt', root).value), date = $('#f-date', root).value;
      if (!name) return toast('Add a description');
      if (!(amt > 0) || amt > MAX_PENCE) return toast('Enter an amount');
      if (!date) return toast('Pick the next date');
      if (f) Object.assign(f, { name, amount: amt, cycle, nextDate: date });
      else S.flows.push({ id: uid(), kind, name, amount: amt, cycle, nextDate: date });
      rollFlows(); save(); closeSheet(); render();
    };
    if (f) $('#f-del', root).onclick = () => { S.flows = S.flows.filter((x) => x !== f); save(); closeSheet(); render(); toast('Flow deleted'); };
  });
}

function openJar(id) {
  const j = id ? S.jars.find((x) => x.id === id) : null;
  if (!j && !isPlus() && S.jars.length >= FREE.jars) return upsell('More than one savings jar');
  const ro = j && !isPlus() && S.jars.indexOf(j) >= FREE.jars;
  openSheet(j ? `${j.emoji} ${j.name}` : 'New Savings Jar', `
    ${j ? `<div class="card" style="text-align:center"><div class="num" style="font-size:32px;font-weight:600">${fmt(j.saved)}</div><div class="muted">of ${fmt(j.target)}</div><div style="margin-top:10px">${progress(j.target ? j.saved / j.target : 0, 'var(--positive)')}</div></div>
      ${ro ? '' : `<label class="f" for="j-add">Add money (£)</label><div class="row-2"><input class="input num" id="j-add" inputmode="decimal" placeholder="0.00"><button class="btn btn-primary" id="j-addbtn" style="flex:0 0 110px">Add</button></div>`}` : ''}
    ${ro ? '<p class="badge" style="margin:8px 0">Read-only on Free. Your data is kept.</p>' : ''}
    <label class="f" for="j-name">Name</label><input class="input" id="j-name" maxlength="30" placeholder="e.g. Summer trip" value="${esc(j?.name || '')}" ${j ? 'data-noautofocus' : ''}>
    <div class="row-2"><div><label class="f" for="j-emoji">Emoji</label><input class="input" id="j-emoji" maxlength="4" value="${esc(j?.emoji || '🎯')}"></div>
    <div><label class="f" for="j-target">Target (£)</label><input class="input num" id="j-target" inputmode="decimal" placeholder="0.00" value="${j ? penceStr(j.target) : ''}"></div></div>
    <label class="f" for="j-dl">Deadline (optional)</label><input class="input" id="j-dl" type="date" value="${j?.deadline || ''}">
    <div style="margin-top:20px">${ro ? '' : `<button class="btn ${j ? 'btn-ghost' : 'btn-primary'}" id="j-save">${j ? 'Save changes' : 'Create Jar'}</button>`}${j ? '<button class="btn btn-danger" id="j-del">Delete</button>' : ''}</div>`, (root) => {
    if (j && !ro) $('#j-addbtn', root).onclick = () => {
      const a = toPence($('#j-add', root).value);
      if (!(a > 0)) return toast('Enter an amount');
      const was = j.saved < j.target;
      j.saved = Math.min(MAX_PENCE, j.saved + a); save(); closeSheet(); render(); haptic();
      if (was && j.saved >= j.target) { confetti(); toast(`${j.emoji} ${j.name} is complete!`); } else toast(`Added ${fmt(a)} to ${j.name}`);
    };
    if (!ro) $('#j-save', root).onclick = () => {
      const name = $('#j-name', root).value.trim(), target = toPence($('#j-target', root).value);
      if (!name) return toast('Name your jar');
      if (!(target > 0) || target > MAX_PENCE) return toast('Enter a target');
      const data = { name, emoji: $('#j-emoji', root).value.trim() || '🎯', target, deadline: $('#j-dl', root).value || null };
      if (j) Object.assign(j, data); else S.jars.push({ id: uid(), saved: 0, ...data });
      save(); closeSheet(); render();
    };
    if (j) $('#j-del', root).onclick = () => { S.jars = S.jars.filter((x) => x !== j); save(); closeSheet(); render(); toast('Jar deleted'); };
  });
}

function openLimit(catId) {
  const existing = catId ? cat(catId) : null;
  const count = S.categories.filter((c) => c.monthlyLimit).length;
  if (!existing && !isPlus() && count >= FREE.limits) return upsell('More than one category limit');
  const options = cats().filter((c) => c === existing || !c.monthlyLimit);
  openSheet(existing ? 'Edit Limit' : 'New Category Limit', `
    <label class="f" for="l-cat">Category</label>
    <select class="input" id="l-cat" ${existing ? 'disabled' : ''}>${options.map((c) => `<option value="${c.id}" ${c === existing ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('')}</select>
    <label class="f" for="l-amt">Monthly limit (£)</label><input class="input num" id="l-amt" inputmode="decimal" placeholder="0.00" value="${existing ? penceStr(existing.monthlyLimit) : ''}">
    <p class="muted small" style="margin-top:8px">You'll see a nudge at 80% and when you go over.</p>
    <div style="margin-top:20px"><button class="btn btn-primary" id="l-save">Save Limit</button>${existing ? '<button class="btn btn-danger" id="l-del">Remove limit</button>' : ''}</div>`, (root) => {
    $('#l-save', root).onclick = () => {
      const c = cat($('#l-cat', root).value), a = toPence($('#l-amt', root).value);
      if (!(a > 0) || a > MAX_PENCE) return toast('Enter a monthly amount');
      c.monthlyLimit = a; save(); closeSheet(); render();
    };
    if (existing) $('#l-del', root).onclick = () => { existing.monthlyLimit = null; save(); closeSheet(); render(); };
  });
}

function openCategory(id) {
  const c = id ? S.categories.find((x) => x.id === id) : null;
  if (!c && !isPlus() && S.categories.filter((x) => !x.isDefault).length >= FREE.customCats) return upsell('More custom categories');
  let color = c?.color || SWATCHES[6];
  openSheet(c ? 'Edit Category' : 'New Category', `
    <div class="row-2"><div style="flex:0 0 90px"><label class="f" for="c-emoji">Emoji</label><input class="input" id="c-emoji" maxlength="4" style="text-align:center;font-size:22px" value="${esc(c?.emoji || '🏷️')}"></div>
    <div><label class="f" for="c-name">Name</label><input class="input" id="c-name" maxlength="24" value="${esc(c?.name || '')}" placeholder="e.g. Coffee"></div></div>
    <label class="f">Colour</label><div class="swatches">${SWATCHES.map((s) => `<button style="background:${s}" data-c="${s}" aria-label="Colour ${s}" class="${s === color ? 'on' : ''}"></button>`).join('')}</div>
    <div style="margin-top:22px"><button class="btn btn-primary" id="c-save">Save</button>${c && c.id !== 'other' ? '<button class="btn btn-danger" id="c-del">Delete</button>' : ''}</div>
    ${c && c.id !== 'other' ? '<p class="muted small" style="margin-top:10px;text-align:center">Deleting moves its expenses to Other.</p>' : ''}`, (root) => {
    $$('.swatches button', root).forEach((b) => (b.onclick = () => { color = b.dataset.c; $$('.swatches button', root).forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#c-save', root).onclick = () => {
      const name = $('#c-name', root).value.trim();
      if (!name) return toast('Name the category');
      const data = { name, emoji: $('#c-emoji', root).value.trim() || '🏷️', color };
      if (c) Object.assign(c, data);
      else S.categories.push({ id: uid(), ...data, sortOrder: Math.max(...S.categories.map((x) => x.sortOrder)) + 1, isDefault: false, monthlyLimit: null });
      save(); closeSheet(); render();
    };
    if (c && c.id !== 'other') $('#c-del', root).onclick = () => {
      const n = S.expenses.filter((e) => e.categoryId === c.id).length;
      if (!confirm(`Delete ${c.name}? ${n} expense${n === 1 ? '' : 's'} will move to Other.`)) return;
      S.expenses.forEach((e) => { if (e.categoryId === c.id) e.categoryId = 'other'; });
      S.categories = S.categories.filter((x) => x !== c);
      if (ui.spCat === c.id) ui.spCat = 'all';
      save(); closeSheet(); render();
    };
  });
}

function infoSheet(title, html) { openSheet(title, `<div>${html}</div><div style="margin-top:18px"><button class="btn btn-ghost" data-action="close">Done</button></div>`); }
const INFO = {
  'backtap-info': ['Set up Back Tap', `<p class="muted">In the iPhone app, a double-tap on the back of your phone opens "How much?" without opening TapTrack. It takes one minute to set up.</p>
    <ol class="steps" style="margin-top:12px"><li>Open Settings → Accessibility → Touch</li><li>Scroll down and tap Back Tap</li><li>Choose Double Tap</li><li>Pick "Log Expense" under TapTrack</li><li>Double-tap the back of your phone to try it</li></ol>
    <p class="muted small">This web draft can't detect back taps. Use the + button instead.</p>`],
  'applepay-info': ['Apple Pay auto-log', `<p class="muted">With TapTrack Plus, an Apple Pay purchase is logged for you and you only confirm the category.</p>
    <ol class="steps" style="margin-top:12px"><li>Open the Shortcuts app → Automation → +</li><li>Choose Transaction, pick your cards, set Run Immediately</li><li>Add the "Log Apple Pay Transaction" action from TapTrack</li><li>Pass in Amount and Merchant</li></ol>
    <p class="muted small">TapTrack never sees card or bank data, only the amount and merchant the automation passes in.</p>`],
  'action-info': ['Action Button & Siri', `<p class="muted">On iPhone 15 Pro and newer, set the Action Button to Shortcut → TapTrack → Log Expense.</p><p class="muted" style="margin-top:10px">Or just say "Log a spend in TapTrack", or "Log £12 lunch in TapTrack".</p>`],
  'widget-info': ['Widgets & Control Center', `<p class="muted">Add the small widget for safe to spend and a one-tap log button, the medium widget for your ring and last 3 spends, or Lock Screen widgets for "£14 left today". On iOS 18, add the Log Expense control to Control Center.</p><p class="muted small" style="margin-top:10px">On the web: in Safari, Share → Add to Home Screen to open this draft like an app.</p>`],
  'icloud-info': ['iCloud sync', `<p class="muted">In the iPhone app, your data syncs through your own private iCloud and is on by default. TapTrack has no servers.</p><p class="muted small" style="margin-top:10px">In this web draft, data is saved only in this browser on this device.</p>`],
  privacy: ['Privacy policy', `<p class="muted">TapTrack collects no data. There are no analytics, ads or trackers. Your spending stays on your device and, in the iPhone app, in your own private iCloud. TapTrack never connects to a bank and never holds or moves money.</p>`],
  terms: ['Terms of use', `<p class="muted">TapTrack helps you track your own spending. It does not provide financial advice. TapTrack Plus is an auto-renewing subscription at £2.99/month (or £19.99/year) with a 7-day free trial, managed through your Apple ID.</p>`],
};

function openReset() {
  openSheet('Reset All Data', `<p class="muted">This deletes every expense, goal, flow and setting in this browser. It can't be undone.</p>
    <label class="f" for="r-in">Type RESET to confirm</label><input class="input" id="r-in" autocomplete="off" autocapitalize="characters">
    <div style="margin-top:18px"><button class="btn btn-danger" id="r-go" disabled style="opacity:.5">Reset All Data</button></div>`, (root) => {
    const inp = $('#r-in', root), go = $('#r-go', root);
    inp.oninput = () => { const ok = inp.value.trim() === 'RESET'; go.disabled = !ok; go.style.opacity = ok ? 1 : 0.5; };
    go.onclick = () => { localStorage.removeItem(KEY); load(); closeSheet(); location.hash = '#today'; render(); openOnboarding(); };
  });
}

function openAppIcon() {
  const icons = [['Default', '#0057FF'], ['Midnight', '#0F1014'], ['Mint', '#32D74B'], ['Sunset', '#FF9500'], ['Rose', '#FF2D55']];
  openSheet('App icon', `<div class="list">${icons.map(([n, c], i) => `<button class="row" data-icon="${n}"><span class="set-tile" style="background:${c};width:40px;height:40px;border-radius:10px">£</span><span class="grow title">${n}${i && !isPlus() ? ' <span class="badge">Plus</span>' : ''}</span>${S.settings.appIcon === n ? '<span class="pos">✓</span>' : ''}</button>`).join('')}</div>
    <p class="muted small">App icons change on iPhone only. This shows the choices.</p>`, (root) => {
    $$('[data-icon]', root).forEach((b) => (b.onclick = () => {
      if (b.dataset.icon !== 'Default' && !isPlus()) return upsell('Extra app icons');
      S.settings.appIcon = b.dataset.icon; save(); closeSheet(); render();
    }));
  });
}

// ---------- Paywall ----------
function openPaywall() {
  let plan = 'yearly';
  openFull(`
    <div style="display:flex;justify-content:flex-end"><button class="icon-btn" data-action="close" aria-label="Close">✕</button></div>
    <div class="ob-big" style="margin-top:0">✨</div>
    <h1 class="ob-title">TapTrack Plus</h1>
    <p class="ob-text">Less typing, more insight.</p>
    <div class="card">
      ${[['💳', 'Apple Pay purchases logged automatically'], ['🧠', 'Smart categories that learn your merchants'], ['🎯', 'Unlimited jars, limits and flows'], ['📊', 'Full history and the calendar heatmap'], ['🎨', 'Extra themes and app icons']].map(([e, t]) => `<div class="benefit"><span>${e}</span><span>${t}</span></div>`).join('')}
    </div>
    <button class="plan-opt on" data-plan="yearly"><span><b>Yearly</b><div class="muted small">£19.99/year · about £1.67/month</div></span><span class="badge">Save 44%</span></button>
    <button class="plan-opt" data-plan="monthly"><span><b>Monthly</b><div class="muted small">£2.99/month</div></span></button>
    <p class="muted small" style="text-align:center;margin:6px 0 14px">7-day free trial, then <span id="pw-price">£19.99/year</span>. Cancel any time in Settings → Apple ID.</p>
    <div class="spacer"></div>
    <button class="btn btn-primary" id="pw-go">Start free trial</button>
    <button class="btn btn-ghost" id="pw-restore">Restore Purchases</button>
    <div class="footer-links"><button data-action="terms">Terms</button><button data-action="privacy">Privacy</button></div>
    <p class="web-note">Web draft: no payment is taken. This turns Plus on in this browser so you can try it.</p>`, (root) => {
    $$('.plan-opt', root).forEach((b) => (b.onclick = () => { plan = b.dataset.plan; $$('.plan-opt', root).forEach((x) => x.classList.toggle('on', x === b)); $('#pw-price', root).textContent = plan === 'yearly' ? '£19.99/year' : '£2.99/month'; }));
    $('#pw-go', root).onclick = () => { S.settings.plus = true; save(); closeSheet(); render(); confetti(); toast('Plus is on (demo)'); };
    $('#pw-restore', root).onclick = () => toast(isPlus() ? 'Plus is already active' : 'No purchases to restore');
  });
}

// ---------- Onboarding ----------
function openOnboarding() {
  let step = 0;
  const ob = { period: S.budget.period, weekly: S.budget.weekly, monthly: S.budget.monthly };
  const draw = () => {
    const dots = `<div class="ob-dots" aria-label="Step ${step + 1} of 5">${[0, 1, 2, 3, 4].map((i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>`;
    const skip = (s) => `<button class="btn btn-ghost" data-ob="skip" data-skip="${s}">Skip</button>`;
    const screens = [
      `<div class="ob-big">👆💸</div><h1 class="ob-title">Log a spend in 3 seconds</h1>
       <p class="ob-text">Pay, double-tap the back of your phone, type the amount. TapTrack shows what's safe to spend today.</p>
       <div class="spacer"></div><p class="muted small" style="text-align:center;margin-bottom:14px">TapTrack helps you track your own spending. It does not provide financial advice.</p>
       <button class="btn btn-primary" data-ob="next">Get started</button>`,
      `<div class="ob-big">🎯</div><h1 class="ob-title">Your budget</h1><p class="ob-text">How much do you want to spend day to day? Bills can stay separate.</p>
       ${segHTML('obp', [['weekly', 'Weekly'], ['monthly', 'Monthly']], ob.period)}
       <label class="f" for="ob-amt">Amount (£)</label><input class="input num" id="ob-amt" inputmode="decimal" style="font-size:28px;text-align:center" value="${penceStr(ob.period === 'weekly' ? ob.weekly : ob.monthly)}">
       <div class="spacer"></div><button class="btn btn-primary" data-ob="budget">Next</button>`,
      `<div class="ob-big">🔁</div><h1 class="ob-title">Fixed stuff</h1><p class="ob-text">Add rent, phone or Netflix so you can see what's really yours each month. Optional.</p>
       <div class="list" id="ob-flows">${S.flows.map((f) => `<div class="row"><span class="grow">${esc(f.name)}</span><span class="amt">${fmt(f.amount)}</span></div>`).join('') || '<div class="row muted">Nothing added yet</div>'}</div>
       <div class="row-2"><input class="input" id="ob-fn" placeholder="e.g. Phone"><input class="input num" id="ob-fa" inputmode="decimal" placeholder="£0.00" style="flex:0 0 110px"></div>
       <button class="btn btn-ghost" data-ob="addflow" style="margin-top:10px">+ Add monthly outflow</button>
       <div class="spacer" style="min-height:20px"></div><button class="btn btn-primary" data-ob="next">Next</button>${skip('flows')}`,
      `<div class="ob-big">📱</div><h1 class="ob-title">Set up Back Tap</h1><p class="ob-text">One minute now saves you opening the app every time.</p>
       <ol class="steps card"><li>Settings → Accessibility → Touch → Back Tap</li><li>Double Tap → TapTrack "Log Expense"</li><li>Double-tap the back of your phone</li></ol>
       <button class="btn btn-ghost" data-ob="test">Test your tap</button>
       <div class="spacer" style="min-height:20px"></div><button class="btn btn-primary" data-ob="next">Done, next</button>${skip('backTap')}`,
      `<div class="ob-big">🔔</div><h1 class="ob-title">A gentle nudge</h1><p class="ob-text">One reminder at 8pm, only on days you haven't logged anything. Plus a heads-up the day before a bill.</p>
       <div class="spacer"></div><button class="btn btn-primary" data-ob="notify">Turn on reminders</button>${skip('notifications')}`,
    ];
    openFull(dots + screens[step], (root) => {
      if (step === 1) wireSeg(root, 'obp', (v) => { ob.period = v; $('#ob-amt', root).value = penceStr(v === 'weekly' ? ob.weekly : ob.monthly); });
      $$('[data-ob]', root).forEach((b) => (b.onclick = async () => {
        const a = b.dataset.ob;
        if (a === 'skip') { S.settings.skipped[b.dataset.skip] = true; if (b.dataset.skip === 'notifications') S.settings.reminder = false; save(); return next(); }
        if (a === 'budget') {
          const p = toPence($('#ob-amt', root).value);
          if (!(p > 0) || p > MAX_PENCE) return toast('Enter a budget');
          S.budget.period = ob.period; S.budget[ob.period] = p; save(); return next();
        }
        if (a === 'addflow') {
          const n = $('#ob-fn', root).value.trim(), p = toPence($('#ob-fa', root).value);
          if (!n || !(p > 0)) return toast('Add a name and amount');
          S.flows.push({ id: uid(), kind: 'outflow', name: n, amount: p, cycle: 'monthly', nextDate: dkey(addDays(new Date(), 7)) });
          save(); return draw();
        }
        if (a === 'test') { haptic(); confetti(); toast('That’s it! In the app this opens "How much?"'); delete S.settings.skipped.backTap; save(); return; }
        if (a === 'notify') {
          try { if ('Notification' in window) await Notification.requestPermission(); } catch (_) {}
          S.settings.reminder = true; save(); return next();
        }
        next();
      }));
    });
  };
  const next = () => {
    if (step === 3 && !S.settings.skipped.backTap) { /* finished Back Tap step */ }
    step++;
    if (step > 4) { S.settings.onboarded = true; S.settings.lastPeriodStart = dkey(periodBounds(S.budget.period).start); save(); closeSheet(); location.hash = '#today'; render(); return; }
    draw();
  };
  draw();
}

// ---------- Sample data ----------
function loadSample() {
  const now = new Date();
  const picks = [['food', 'Flat white', 340], ['food', 'Meal deal', 395], ['transport', 'Bus', 175], ['shopping', 'Socks', 1200], ['fun', 'Cinema', 1150], ['food', 'Groceries', 2340], ['health', 'Paracetamol', 89], ['transport', 'Train', 830], ['food', 'Pizza', 1450], ['other', 'Gift wrap', 300]];
  for (let i = 0; i < 26; i++) {
    const d = addDays(now, -Math.floor(i / 1.4));
    const [c, note, p] = picks[(i * 7) % picks.length];
    d.setHours(8 + ((i * 5) % 12), (i * 13) % 60);
    if (d > now) d.setTime(now.getTime() - 3600000 * (i + 1));
    addExpense({ amount: p + ((i * 37) % 90), categoryId: c, note, date: d.toISOString() });
  }
  if (!S.flows.length) S.flows.push(
    { id: uid(), kind: 'inflow', name: 'Student loan', amount: 120000, cycle: 'monthly', nextDate: dkey(addDays(now, 12)) },
    { id: uid(), kind: 'inflow', name: 'Part-time job', amount: 48000, cycle: 'monthly', nextDate: dkey(addDays(now, 5)) },
    { id: uid(), kind: 'outflow', name: 'Rent', amount: 65000, cycle: 'monthly', nextDate: dkey(addDays(now, 1)) },
    { id: uid(), kind: 'outflow', name: 'Netflix', amount: 1099, cycle: 'monthly', nextDate: dkey(addDays(now, 9)) },
    { id: uid(), kind: 'outflow', name: 'Amazon Prime', amount: 9500, cycle: 'yearly', nextDate: dkey(addDays(now, 80)) });
  if (!S.jars.length) S.jars.push({ id: uid(), name: 'Summer trip', emoji: '🏖️', target: 50000, saved: 18000, deadline: dkey(addDays(now, 200)) });
  const food = cat('food'); if (!S.categories.some((c) => c.monthlyLimit)) food.monthlyLimit = 15000;
  save(); render(); toast('Sample data added');
}

// ---------- CSV export ----------
function exportCSV() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['date', 'amount', 'currency', 'category', 'note', 'merchant', 'source'].join(',')];
  [...S.expenses].sort(byDateDesc).forEach((e) => lines.push([e.date, penceStr(e.amount), 'GBP', cat(e.categoryId).name, e.note, e.merchant, e.source].map(q).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `taptrack-export-${dkey(new Date())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Exported ${S.expenses.length} expenses`);
}

// ---------- Router & render ----------
const VIEWS = { today: viewToday, spending: viewSpending, goals: viewGoals, plan: viewPlan, settings: viewSettings, categories: viewCategories };
function route() { const r = location.hash.slice(1); return VIEWS[r] ? r : 'today'; }
function applyTheme() {
  document.documentElement.dataset.theme = S.settings.theme;
  const dark = S.settings.theme === 'dark' || (S.settings.theme === 'system' && !matchMedia('(prefers-color-scheme: light)').matches);
  $('meta[name=theme-color]').content = dark ? '#0F1014' : '#F2F2F7';
}
function render() {
  rollFlows();
  applyTheme();
  const r = route();
  $('#app').innerHTML = VIEWS[r]();
  const tab = r === 'settings' || r === 'categories' ? 'today' : r;
  $$('.tab').forEach((t) => { const on = t.dataset.tab === tab; t.classList.toggle('on', on); on ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current'); });
  wireSwipes();
  animateHero();
}
function animateHero() {
  const el = $('[data-hero]');
  const from = ui.lastSafe; ui.lastSafe = null;
  if (!el || from == null || reduceMotion()) return;
  const to = Number(el.dataset.hero);
  if (from === to) return;
  const t0 = performance.now(), dur = 700;
  const tick = (t) => { const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

function wireSwipes() {
  $$('[data-swipe]').forEach((wrap) => {
    const row = $('.row', wrap);
    let x0 = null, y0 = 0, dx = 0, moved = false;
    row.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; dx = 0; moved = false; });
    row.addEventListener('pointermove', (e) => {
      if (x0 == null) return;
      dx = Math.min(0, e.clientX - x0);
      if (Math.abs(e.clientY - y0) > 20 && !moved) { x0 = null; row.style.transform = ''; return; }
      if (dx < -8) { moved = true; row.style.transition = 'none'; row.style.transform = `translateX(${dx}px)`; }
    });
    const end = () => {
      if (x0 == null) return;
      row.style.transition = '';
      if (dx < -90) { row.style.transform = 'translateX(-100%)'; setTimeout(() => deleteExpense(wrap.dataset.swipe), 180); }
      else row.style.transform = '';
      x0 = null;
    };
    row.addEventListener('pointerup', end);
    row.addEventListener('pointercancel', end);
    row.addEventListener('pointerleave', end);
    row.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  });
}

// ---------- Actions ----------
const ACTIONS = {
  quicklog: () => openQuickLog(),
  'edit-expense': (el) => openQuickLog(el.dataset.id),
  close: () => closeSheet(),
  'no-spend': () => { const k = dkey(new Date()); if (!S.noSpend.includes(k)) S.noSpend.push(k); save(); render(); haptic(); toast('Nice. No-spend day logged 🔥'); },
  'sp-period': (el) => { ui.spPeriod = el.dataset.v; ui.spOffset = 0; ui.spDay = null; render(); },
  'sp-prev': () => { if (!isPlus()) return upsell('Past periods'); ui.spOffset--; ui.spDay = null; render(); },
  'sp-next': () => { if (ui.spOffset < 0) { ui.spOffset++; ui.spDay = null; render(); } },
  'sp-day': (el) => { ui.spDay = ui.spDay === el.dataset.v || !el.dataset.v ? null : el.dataset.v; render(); if (ui.spDay) $('#sp-list')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); },
  'sp-cat': (el) => { ui.spCat = el.dataset.v; render(); },
  'budget-edit': () => openBudget(),
  'flow-new': (el) => openFlow(null, el.dataset.v),
  'flow-open': (el) => openFlow(el.dataset.id),
  'jar-new': () => openJar(),
  'jar-open': (el) => openJar(el.dataset.id),
  'limit-new': () => openLimit(),
  'limit-open': (el) => openLimit(el.dataset.id),
  'cat-new': () => openCategory(),
  'cat-open': (el) => openCategory(el.dataset.id),
  'cat-move': (el) => {
    const list = cats(), i = list.findIndex((c) => c.id === el.dataset.id), j = i + Number(el.dataset.v);
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((c, n) => (c.sortOrder = n)); save(); render();
  },
  paywall: () => openPaywall(),
  'plus-off': () => { S.settings.plus = false; save(); render(); toast('Plus turned off. Your data is kept.'); },
  theme: (el) => { S.settings.theme = el.dataset.v; save(); render(); },
  'app-icon': () => openAppIcon(),
  export: () => exportCSV(),
  sample: () => loadSample(),
  onboard: () => openOnboarding(),
  reset: () => openReset(),
  'move-leftover': () => { const j = S.jars[0], a = S.pendingLeftover.amount, was = j.saved < j.target; j.saved = Math.min(MAX_PENCE, j.saved + a); S.pendingLeftover = null; save(); render(); toast(`Moved ${fmt(a)} into ${j.name}`); if (was && j.saved >= j.target) confetti(); },
  'dismiss-leftover': () => { S.pendingLeftover = null; save(); render(); },
  'dismiss-backtap': () => { delete S.settings.skipped.backTap; save(); render(); },
};
for (const k of Object.keys(INFO)) ACTIONS[k] = () => infoSheet(...INFO[k]);

document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.matches?.('.overlay')) return closeSheet();
  const r = t.closest('[data-route]');
  if (r) { closeSheet(); location.hash = '#' + r.dataset.route; return; }
  const tab = t.closest('[data-tab]');
  if (tab) { location.hash = '#' + tab.dataset.tab; return; }
  const a = t.closest('[data-action]');
  if (a && ACTIONS[a.dataset.action]) ACTIONS[a.dataset.action](a, e);
});
document.addEventListener('change', (e) => {
  const tg = e.target.dataset.toggle;
  if (!tg) return;
  if (tg === 'includeBills') S.budget.includeBills = e.target.checked;
  else S.settings[tg] = e.target.checked;
  if (tg === 'reminder' && e.target.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  save(); render();
});
document.addEventListener('input', (e) => {
  const k = e.target.dataset.input;
  if (k === 'sp-query') {
    ui.spQuery = e.target.value;
    const r = spendingRange(); const all = S.expenses.filter((x) => inRange(x, r));
    const buckets = ui.spDay ? (() => { const s = ui.spDay.startsWith('m') ? new Date(r.start.getFullYear(), +ui.spDay.slice(1), 1) : fromKey(ui.spDay); const en = ui.spDay.startsWith('m') ? new Date(s.getFullYear(), s.getMonth() + 1, 1) : addDays(s, 1); return [{ key: ui.spDay, s, e: en }]; })() : [];
    $('#sp-list').innerHTML = spendingList(all, buckets, 'Nothing logged yet');
    wireSwipes();
  }
  if (k === 'reminder-time') { S.settings.reminderTime = e.target.value || '20:00'; save(); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#layer').innerHTML) closeSheet();
});
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); render(); });
matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => S.settings.theme === 'system' && applyTheme());

// ---------- Timers: midnight recalc + reminders ----------
let lastDay = dkey(new Date());
setInterval(() => {
  const now = new Date(), k = dkey(now);
  if (k !== lastDay) { lastDay = k; checkPeriodRollover(); if (!$('#layer').innerHTML) render(); }
  const s = S.settings;
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (s.reminder && hhmm >= s.reminderTime && s.lastReminder !== k && 'Notification' in window && Notification.permission === 'granted') {
    const logged = S.expenses.some((e) => dkey(e.date) === k) || S.noSpend.includes(k);
    s.lastReminder = k; save();
    if (!logged) try { new Notification('TapTrack', { body: 'Anything to log today? Tap to add, or mark it a no-spend day.', icon: 'icon.svg' }); } catch (_) {}
  }
}, 30000);

// ---------- Boot ----------
load();
checkPeriodRollover();
render();
if (!S.settings.onboarded) openOnboarding();
