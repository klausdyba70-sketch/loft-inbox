// Google-Kalender NUR LESEN über die geheimen iCal-Adressen.
// Über diese Adressen kann man technisch nichts eintragen oder ändern. Anny und der Abgleich bleiben unberührt.
const TZ = 'Europe/Berlin';
export const CALS = [
  { key: 'P', env: 'GCAL_PENTHOUSE_ICS', name: 'Penthouse Loft' },
  { key: 'F', env: 'GCAL_FACTORY_ICS', name: 'Factory Loft' },
];
export const calConfigured = () => Object.fromEntries(CALS.map((c) => [c.key, !!process.env[c.env]]));

// ---- Zeitzonen ----
function tzOffset(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
}
export function zoned(y, mo, d, h = 0, mi = 0, s = 0, tz = TZ) {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return t;
}
const safeTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch (e) { return TZ; } };

// ---- iCal lesen ----
function unfold(text) { return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, ''); }
function unescape(v) { return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1'); }
function parseLine(line) {
  const i = line.indexOf(':'); if (i < 0) return null;
  const [name, ...params] = line.slice(0, i).split(';');
  const p = {}; for (const x of params) { const [k, v] = x.split('='); if (k) p[k.toUpperCase()] = (v || '').replace(/^"|"$/g, ''); }
  return { name: name.toUpperCase(), params: p, value: line.slice(i + 1) };
}
// liefert { allDay, parts:[y,m,d,h,mi,s], tz|utc }
function parseDate(v, p) {
  const m = v.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const parts = [+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
  const allDay = p.VALUE === 'DATE' || !m[4];
  return { allDay, parts, utc: !!m[7], tz: allDay ? TZ : safeTz(p.TZID || TZ) };
}
const toMs = (dt) => dt.utc ? Date.UTC(...dt.parts) : zoned(...dt.parts, dt.tz);

export function parseIcs(text) {
  const events = []; let cur = null;
  for (const line of unfold(text).split('\n')) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const l = parseLine(line); if (!l) continue;
    if (l.name === 'DTSTART') cur.start = parseDate(l.value, l.params);
    else if (l.name === 'DTEND') cur.end = parseDate(l.value, l.params);
    else if (l.name === 'DURATION') cur.duration = l.value;
    else if (l.name === 'SUMMARY') cur.summary = unescape(l.value);
    else if (l.name === 'UID') cur.uid = l.value;
    else if (l.name === 'RRULE') cur.rrule = Object.fromEntries(l.value.split(';').map((x) => x.split('=')));
    else if (l.name === 'EXDATE') for (const v of l.value.split(',')) { const d = parseDate(v, l.params); if (d) cur.exdates.push(toMs(d)); }
    else if (l.name === 'RECURRENCE-ID') { const d = parseDate(l.value, l.params); if (d) cur.recurrenceId = toMs(d); }
    else if (l.name === 'STATUS') cur.status = l.value.toUpperCase();
    else if (l.name === 'TRANSP') cur.transp = l.value.toUpperCase();
  }
  return events;
}
function durMs(s) {
  const m = (s || '').match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  return (((+(m[1] || 0) * 7 + +(m[2] || 0)) * 24 + +(m[3] || 0)) * 60 + +(m[4] || 0)) * 60000 + +(m[5] || 0) * 1000;
}
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

// Termine (auch wiederkehrende) im Zeitraum [from, to) als einzelne Vorkommen
export function expand(events, from, to) {
  const out = [];
  const overrides = new Set(events.filter((e) => e.recurrenceId != null).map((e) => e.uid + '|' + e.recurrenceId));
  for (const e of events) {
    if (e.status === 'CANCELLED' || e.transp === 'TRANSPARENT') continue;
    const s0 = toMs(e.start);
    const len = e.end ? toMs(e.end) - s0 : e.duration ? durMs(e.duration) : e.start.allDay ? 864e5 : 0;
    const push = (s) => { const en = s + Math.max(len, 0); if (s < to && en > from) out.push({ start: s, end: en, allDay: e.start.allDay, title: e.summary || '' }); };
    if (!e.rrule || e.recurrenceId != null) { push(s0); continue; }
    const r = e.rrule, freq = r.FREQ, step = Math.max(1, +(r.INTERVAL || 1));
    const until = r.UNTIL ? toMs(parseDate(r.UNTIL, {}) || { parts: [9999, 0, 1, 0, 0, 0], utc: true }) : Infinity;
    const count = r.COUNT ? +r.COUNT : Infinity;
    const byday = r.BYDAY ? r.BYDAY.split(',').map((x) => WD[x.slice(-2)]).filter((x) => x != null) : null;
    const [y, mo, d, h, mi, sec] = e.start.parts;
    const at = (Y, M, D) => e.start.utc ? Date.UTC(Y, M, D, h, mi, sec) : zoned(Y, M, D, h, mi, sec, e.start.tz);
    const ex = new Set(e.exdates);
    let n = 0;
    const emit = (s) => { if (s < s0 || s > until || n >= count) return false; n++; if (!ex.has(s) && !overrides.has(e.uid + '|' + s)) push(s); return true; };
    for (let i = 0; i < 3000 && n < count; i++) {
      let base;
      if (freq === 'DAILY') base = [y, mo, d + i * step];
      else if (freq === 'WEEKLY') base = [y, mo, d + i * 7 * step];
      else if (freq === 'MONTHLY') base = [y, mo + i * step, d];
      else if (freq === 'YEARLY') base = [y + i * step, mo, d];
      else break;
      const first = at(...base);
      if (first > to || first > until) break;
      if (freq === 'WEEKLY' && byday) {
        const wd0 = new Date(Date.UTC(...base)).getUTCDay(), mon = (wd0 + 6) % 7;
        for (const w of [...byday].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))) emit(at(base[0], base[1], base[2] - mon + ((w + 6) % 7)));
      } else if (freq === 'MONTHLY' && new Date(Date.UTC(...base)).getUTCDate() !== d) continue; // z. B. 31. in kurzen Monaten
      else emit(first);
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---- Abruf mit kurzem Zwischenspeicher pro Funktionsinstanz ----
const cache = new Map();
async function fetchIcs(url) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 60_000) return hit.events;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { accept: 'text/calendar' } });
  if (!res.ok) throw new Error(res.status === 404 ? 'Adresse nicht gefunden (Link geändert?)' : 'Kalender-Adresse antwortet mit ' + res.status);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Unter der Adresse liegt keine Kalenderdatei (.ics). Bitte den iCal-Link prüfen.');
  const events = parseIcs(text);
  cache.set(url, { at: Date.now(), events });
  return events;
}

// Belegung beider Lofts im Zeitraum
export async function busy(from, to) {
  const res = { configured: calConfigured(), events: [], errors: {} };
  await Promise.all(CALS.map(async (c) => {
    const url = process.env[c.env]; if (!url) return;
    try { for (const o of expand(await fetchIcs(url), from, to)) res.events.push({ studio: c.key, ...o }); }
    catch (e) { res.errors[c.key] = e.name === 'TimeoutError' ? 'Kalender hat nicht rechtzeitig geantwortet' : e.message; }
  }));
  res.events.sort((a, b) => a.start - b.start);
  return res;
}

// ---- Hilfen für Tage (Berliner Zeit) ----
export const dayStart = (iso) => { const [y, m, d] = iso.split('-').map(Number); return zoned(y, m - 1, d); };
const hm = (ms) => new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(ms));
export function isoDay(ms) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
function addDays(iso, n) { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }

// "frei" | "ganztägig belegt" | "belegt 10:00–14:00"
export function dayText(events, studio, iso) {
  const s = dayStart(iso), e = dayStart(addDays(iso, 1));
  const ev = events.filter((x) => x.studio === studio && x.start < e && x.end > s);
  if (!ev.length) return 'frei';
  if (ev.some((x) => x.allDay || (x.start <= s && x.end >= e))) return 'ganztägig belegt';
  return 'belegt ' + ev.map((x) => `${hm(Math.max(x.start, s))}–${hm(Math.min(x.end, e))}`).join(', ');
}

// Kalender-Zeile für die KI: Wunschtermin und freie Ausweichtage
export async function availabilityForPrompt(dateIso, studio) {
  if (!dateIso) return '';
  const cfg = calConfigured(); if (!cfg.P && !cfg.F) return '';
  const from = dayStart(addDays(dateIso, -7)), to = dayStart(addDays(dateIso, 15));
  const b = await busy(from, to);
  const lofts = CALS.filter((c) => cfg[c.key] && !b.errors[c.key] && (studio === 'X' || !studio || studio === c.key));
  if (!lofts.length) return '';
  const today = isoDay(Date.now());
  const lines = lofts.map((c) => {
    const t = dayText(b.events, c.key, dateIso);
    let alt = '';
    if (t !== 'frei') {
      const free = [];
      for (let i = 1; i <= 14 && free.length < 2; i++) for (const k of [i, -i]) { const dd = addDays(dateIso, k); if (dd > today && dayText(b.events, c.key, dd) === 'frei' && free.length < 2) free.push(dd); }
      alt = free.length ? ` Zwei freie Alternativen: ${free.sort().map((d) => new Date(d + 'T12:00:00Z').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'numeric', timeZone: 'UTC' })).join(' und ')}.` : '';
    }
    return `- ${c.name} am ${dateIso}: ${t}.${alt}`;
  });
  return `Kalender (nur Lesestand, Stand jetzt):\n${lines.join('\n')}`;
}
