// KI für die Loft Inbox: Einstufung, Antwortvorschläge, Verfeinern, Fragen, Testmodus
import { availabilityForPrompt, overviewForPrompt } from './cal.mjs';
import { MAILBOX, admin } from './core.mjs';

const MODEL_FAST = process.env.AI_MODEL_FAST || 'claude-haiku-5-5';
const MODEL_WRITE = process.env.AI_MODEL_WRITE || 'claude-sonnet-5-5';
const NOTION_PAGE = process.env.NOTION_PAGE_ID || '1f2dc5aac79d80d38d23d7639ee9be8d';
export const CATS = ['Verfügbarkeit', 'Preis', 'Besichtigung', 'Buchung', 'Workshop / Seminar', 'Event', 'Ausstattung', 'Sonstiges'];
const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// Grundwissen, falls Notion (noch) nicht verbunden ist. Preise stehen bewusst NICHT hier.
const BASE_FACTS = `Loft Studio Cologne, Köln. Zwei Mietstudios:
Sprache: Es heißt DAS Factory Loft und DAS Penthouse Loft (sächlich, wie "das Loft"). Also: das Factory Loft ist frei, im Factory Loft, für das Penthouse Loft, des Penthouse Lofts. Nie "der" oder "die" Factory/Penthouse Loft.
- Factory Loft: Foto, Film, Seminare und Workshops. 4 Tische à 4 Personen, 16 Stühle, max. 16 Personen. Styling- und Make-up-Ecke.
- Penthouse Loft: max. 20 Personen. Küche mit Kapselmaschine (kompostierbare Kapseln) und Milchschäumer. Make-up-Raum. Bad mit Dusche im WC.
- Beide Lofts zusammen ca. 180 m², davon ca. 120 m² Arbeitsraum.
- Keine Vorauszahlung, die Rechnung kommt nach der Miete. Eigenes Catering ist möglich.
- Equipment wird nicht vermietet, C-Stands kostenfrei auf Anfrage.`;

// Lange, gleichbleibende Anweisungen (FAQ) zwischenspeichern: schneller und günstiger
const sys = (system) => (system && system.length > 6000 ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system);
// ---------- Kosten mitschreiben (Preise in US-Dollar pro 1 Mio. Tokens, Stand Nov. 2026) ----------
const PRICES = {
  haiku: { in: 0.10, out: 0.50, cw: 0.125, cr: 0.01, inBig: 0.50, outBig: 2.50, cwBig: 0.625, crBig: 0.05 },
  sonnet: { in: 2.00, out: 10.00, cw: 2.50, cr: 0.10 },
  opus: { in: 5.00, out: 25.00, cw: 6.25, cr: 0.50 },
};
export function costUsd(model, u = {}) {
  const p = PRICES[/sonnet/.test(model) ? 'sonnet' : /opus/.test(model) ? 'opus' : 'haiku'];
  const i = u.input_tokens || 0, o = u.output_tokens || 0, cw = u.cache_creation_input_tokens || 0, cr = u.cache_read_input_tokens || 0;
  const big = p.inBig && i + cw + cr > 100000; // Haiku: über 100k Tokens Prompt gilt der höhere Preis
  return (i * (big ? p.inBig : p.in) + o * (big ? p.outBig : p.out) + cw * (big ? p.cwBig : p.cw) + cr * (big ? p.crBig : p.cr)) / 1e6;
}
export function logUsage(model, kind, u) {
  if (!u) return Promise.resolve();
  return admin().from('ai_usage').insert({ model, kind, input: u.input_tokens || 0, output: u.output_tokens || 0, cache_write: u.cache_creation_input_tokens || 0, cache_read: u.cache_read_input_tokens || 0, cost_usd: costUsd(model, u) })
    .then(({ error }) => { if (error) console.error('ai_usage:', error.message); }, (e) => console.error('ai_usage:', e.message));
}
// Das Modell denkt sonst von sich aus lange nach (langsam, verbraucht alle Tokens). Für Mails nicht nötig: Nachdenken aus.
let thinkingOff = { thinking: { type: 'disabled' } };
async function apiCall(payload, headers, signal) {
  const send = () => fetch('https://api.anthropic.com/v1/messages', { method: 'POST', signal, headers, body: JSON.stringify({ ...payload, ...thinkingOff }) });
  let r = await send();
  if (r.status === 400 && Object.keys(thinkingOff).length) {
    const j = await r.clone().json().catch(() => ({}));
    if (/thinking/i.test(j.error?.message || '')) { console.error('thinking:disabled abgelehnt:', j.error?.message); thinkingOff = {}; r = await send(); }
  }
  return r;
}
export async function claude({ model = MODEL_FAST, system, prompt, max_tokens = 1000, timeoutMs = 25000, kind = 'sonstiges' }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY fehlt in Netlify'), { status: 409 });
  const r = await apiCall({ model, max_tokens, system: sys(system), messages: [{ role: 'user', content: prompt }] },
    { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, AbortSignal.timeout(timeoutMs));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('KI: ' + (j.error?.message || 'Fehler ' + r.status)), { status: r.status === 401 ? 409 : 502 });
  if (r.ok) await logUsage(j.model || model, kind, j.usage);
  const text = (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
  if (!text) { // genau sagen, warum nichts kam
    const why = `ohne Streaming: Ende ${j.stop_reason || '?'}, Teile ${(j.content || []).map((c) => c.type).join('+') || 'keine'}, Modell ${j.model || model}, Eingabe ${j.usage?.input_tokens ?? '?'} Tokens, Ausgabe ${j.usage?.output_tokens ?? '?'}`;
    console.error('KI leer', why);
    throw Object.assign(new Error('Die KI hat keinen Text geliefert (' + why + ')'), { status: 502 });
  }
  return text;
}
// Tolerant: entfernt Code-Zäune, repariert rohe Zeilenumbrüche in Texten
function escapeInStrings(src) {
  let out = '', inStr = false, esc = false;
  for (const ch of src) {
    if (inStr) {
      if (esc) { out += ch; esc = false; continue; }
      if (ch === '\\') { out += ch; esc = true; continue; }
      if (ch === '"') { inStr = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else { if (ch === '"') inStr = true; out += ch; }
  }
  return out;
}
export function parseJson(t) {
  const clean = String(t || '').replace(/```(?:json)?/gi, '');
  const a = clean.indexOf('{'), b = clean.lastIndexOf('}');
  if (a < 0 || b < a) throw Object.assign(new Error('KI-Antwort ohne JSON'), { raw: clean });
  const body = clean.slice(a, b + 1);
  try { return JSON.parse(body); } catch (e) { return JSON.parse(escapeInStrings(body)); }
}
async function claudeJson(opts, tries = 2) {
  let last;
  for (let i = 0; i < tries; i++) {
    const txt = await claude({ ...opts, prompt: i ? opts.prompt + '\n\nWICHTIG: Antworte ausschließlich mit einem gültigen JSON-Objekt, ohne weiteren Text.' : opts.prompt });
    try { return parseJson(txt); } catch (e) { last = e; }
  }
  throw new Error('Die KI hat in einem unerwarteten Format geantwortet. Bitte nochmal versuchen.');
}
const todayLine = () => { const d = new Date(); return `Heute ist ${WD[d.getDay()]}, der ${d.toISOString().slice(0, 10)}.`; };

// ---------- Wissen aus Notion ----------
async function notionBlocks(id, token, deadline, depth = 0, out = []) {
  let cursor = null;
  do {
    if (Date.now() > deadline) { out.truncated = true; return out; }
    const u = `https://api.notion.com/v1/blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`;
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token, 'Notion-Version': '2022-06-28' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 404 || j.code === 'object_not_found') throw new Error('Notion findet die FAQ-Seite nicht. Bitte die Seite in Notion über ••• → Verbindungen mit "Loft Inbox" teilen.');
      if (r.status === 401 || j.code === 'unauthorized') throw new Error('NOTION_TOKEN ist ungültig. Bitte den Schlüssel der Verbindung "Loft Inbox" neu in Netlify eintragen.');
      throw new Error('Notion: ' + (j.message || 'Fehler ' + r.status));
    }
    for (const b of j.results || []) {
      const d = b[b.type] || {};
      const txt = (d.rich_text || []).map((x) => x.plain_text).join('');
      if (b.type === 'table_row') out.push((d.cells || []).map((c) => c.map((x) => x.plain_text).join('')).join(' | '));
      else if (b.type === 'child_page') out.push('\n# ' + (d.title || ''));
      else if (txt) out.push((b.type.startsWith('heading') ? '\n## ' : b.type.includes('list_item') || b.type === 'to_do' ? '- ' : '') + txt);
      if (b.has_children && depth < 4 && b.type !== 'child_database') await notionBlocks(b.id, token, deadline, depth + 1, out);
    }
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return out;
}
export async function refreshKnowledge(db, force = false) {
  const token = process.env.NOTION_TOKEN;
  if (!token) return { ok: false, reason: 'NOTION_TOKEN fehlt in Netlify' };
  const { data: k } = await db.from('knowledge').select('synced_at').eq('id', NOTION_PAGE).maybeSingle();
  if (!force && k && Date.now() - new Date(k.synced_at).getTime() < 7 * 24 * 36e5) return { ok: true, synced_at: k.synced_at };
  try {
    const lines = await notionBlocks(NOTION_PAGE, token, Date.now() + 7000);
    const content = lines.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 60000);
    if (!content.trim()) throw new Error('Die Notion-Seite ist leer oder nicht lesbar.');
    const synced_at = new Date().toISOString();
    await db.from('knowledge').upsert({ id: NOTION_PAGE, title: 'Loft Studio Cologne FAQ (Notion)', content, synced_at });
    await db.from('sync_state').upsert({ key: 'notion:last_error', value: {}, updated_at: synced_at });
    return { ok: true, synced_at, chars: content.length, truncated: !!lines.truncated };
  } catch (e) {
    await db.from('sync_state').upsert({ key: 'notion:last_error', value: { at: new Date().toISOString(), message: e.message }, updated_at: new Date().toISOString() });
    return { ok: false, reason: e.message };
  }
}
// Nur die zum Verlauf passenden Abschnitte mitschicken: schneller und günstiger
function relevant(text, focus, max = 9000) {
  if (text.length <= max) return text;
  const lines = text.split('\n'), chunks = [];
  let cur = '';
  for (const l of lines) { if (cur.length > 500 && (l.startsWith('#') || /^(frage|q:|\*\*)/i.test(l) || cur.length > 900)) { chunks.push(cur); cur = ''; } cur += l + '\n'; }
  if (cur) chunks.push(cur);
  const words = new Set((focus.toLowerCase().match(/[a-zäöüß]{4,}/g) || []));
  const scored = chunks.map((c, i) => { const w = c.toLowerCase().match(/[a-zäöüß]{4,}/g) || []; let sc = 0; for (const x of w) if (words.has(x)) sc++; return { c, i, sc: sc / Math.sqrt(w.length + 5) + (i === 0 ? 1 : 0) }; });
  const pick = []; let len = 0;
  for (const s of scored.sort((a, b) => b.sc - a.sc)) { if (len + s.c.length > max) continue; pick.push(s); len += s.c.length; }
  return pick.sort((a, b) => a.i - b.i).map((s) => s.c).join('…\n');
}
async function knowledge(db, focus = '') {
  const { data } = await db.from('knowledge').select('content').limit(5);
  const notion = relevant((data || []).map((r) => r.content).join('\n\n'), focus);
  return notion ? `${BASE_FACTS}\n\nAktuelle Infos aus Notion (diese gelten vorrangig, auch für Preise):\n${notion}` : BASE_FACTS;
}

// ---------- Verlauf laden ----------
async function loadThread(db, threadId) {
  const { data: t } = await db.from('threads').select('id,subject,status,studio,category,priority,ai_at,is_test,summary,requested_date,contacts(name,email)').eq('id', threadId).maybeSingle();
  if (!t) throw Object.assign(new Error('Anfrage nicht gefunden'), { status: 404 });
  const { data: msgs } = await db.from('messages').select('direction,body_text,sent_at').eq('thread_id', threadId).order('sent_at');
  return { t, msgs: msgs || [] };
}
const convoText = (msgs, n = 6) => msgs.slice(-n).map((m) => `[${m.direction === 'in' ? 'KUNDE' : 'LOFT STUDIO'} · ${String(m.sent_at).slice(0, 16).replace('T', ' ')}]\n${(m.body_text || '').slice(0, 2500)}`).join('\n\n');

// ---------- Einstufung ----------
export async function classifyThread(db, threadId) {
  const { t, msgs } = await loadThread(db, threadId);
  if (!msgs.length) return null;
  const system = `Du sortierst E-Mails im Postfach von Loft Studio Cologne, einem Vermieter von zwei Foto-, Film- und Event-Studios in Köln (Penthouse Loft und Factory Loft).
kind:
- "anfrage": Jede Nachricht von Menschen, die die Lofts mieten, buchen, besichtigen wollen oder Fragen zu Preis, Verfügbarkeit, Ausstattung, Ablauf oder einer bestehenden Buchung haben. Auch Agenturen und Produktionsfirmen. Im Zweifel immer "anfrage".
- "sonstiges": Rechnungen, Zahlungen, Behörden, Lieferanten, Newsletter, Benachrichtigungen von Plattformen (Instagram, Booking-Tools), Systemmails, Kooperationsangebote ohne Mietabsicht.
- "spam": Werbung für SEO, Marketing, Listings, Phishing, gefälschte Mahnungen, Massenmails.
spam_score 0 bis 100: Wahrscheinlichkeit für Spam.
studio: "P" Penthouse, "F" Factory, "X" unklar oder beide.
category: eine aus ${JSON.stringify(CATS)}, bei sonstiges/spam null.
requested_date: das gewünschte Miet- oder Termin-Datum als YYYY-MM-DD, sonst null. Jahr sinnvoll ergänzen (nächstes passendes Datum ab heute).
priority: "hoch" bei Termin in den nächsten 7 Tagen oder Rückfrage zu einer bestehenden Buchung, die eilt; "niedrig" bei sonstiges/spam; sonst "normal".
summary: Deutsch, 1 bis 2 kurze Sätze, sachlich: was gewünscht ist, Datum, Uhrzeit, Personenzahl, offene Fragen. Bei sonstiges z. B. "Rechnung von X über Y". Keine Gedankenstriche.
Antworte nur mit JSON.`;
  const prompt = `${todayLine()}
Absender: ${t.contacts?.name || ''} <${t.contacts?.email || ''}>
Betreff: ${t.subject}

Verlauf (neueste zuletzt):
${convoText(msgs)}

JSON: {"kind":"anfrage|sonstiges|spam","spam_score":0,"studio":"P|F|X","category":null,"requested_date":null,"priority":"normal","summary":""}`;
  const r = (await claudeJson({ model: MODEL_FAST, system, prompt, max_tokens: 400, kind: 'Einstufen' }));
  const kind = ['anfrage', 'sonstiges', 'spam'].includes(r.kind) ? r.kind : 'anfrage';
  const spam = Math.max(0, Math.min(100, Math.round(+r.spam_score || 0)));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.requested_date || '') ? r.requested_date : null;
  const first = !t.ai_at;
  const patch = { kind, spam_score: spam, summary: String(r.summary || '').slice(0, 600), requested_date: date, ai_at: new Date().toISOString() };
  if (['P', 'F'].includes(r.studio)) patch.requested_studio = r.studio;
  if (t.studio === 'X' && ['P', 'F'].includes(r.studio)) patch.studio = r.studio;
  if (!t.category && kind === 'anfrage' && CATS.includes(r.category)) patch.category = r.category;
  if (first && ['hoch', 'normal', 'niedrig'].includes(r.priority)) patch.priority = r.priority;
  if (date && kind === 'anfrage' && t.status === 'offen') {
    const days = (new Date(date) - new Date(new Date().toISOString().slice(0, 10))) / 864e5;
    if (days >= 0 && days <= 7) patch.priority = 'hoch';
  }
  if (first && kind === 'spam' && spam >= 90 && t.status === 'offen') patch.status = 'spam';
  await db.from('threads').update(patch).eq('id', threadId);
  return { ...patch };
}

// ---------- Antwortvorschläge (eine Variante pro Aufruf, damit es schnell bleibt) ----------
export const VARIANTS = [
  { key: 'direkt', hint: 'Kurz und auf den Punkt. Geh die Fragen des Kunden der Reihe nach durch und beantworte jede in ein bis zwei Sätzen. Dann ein Satz zum nächsten Schritt. Nichts dazu erzählen, was nicht gefragt war.' },
];
async function settingsRow(db) {
  let { data, error } = await db.from('settings').select('tone,signature,ai_rules').eq('id', true).maybeSingle();
  if (error) ({ data } = await db.from('settings').select('tone,signature').eq('id', true).maybeSingle()); // Spalte ai_rules noch nicht angelegt
  return { tone: 'du', signature: 'Viele Grüße,\n\nKlaus Dyba\n\nLoft Studio Cologne\nRichard Wagner Str. 18\n50674 Köln\nTel. +49 151 16790949\nwww.loftstudiocologne.com', ...(data || {}), rules: data?.ai_rules || '' };
}
async function styleSamples(db, threadId) {
  const { data } = await db.from('messages').select('body_text,thread_id').eq('direction', 'out').neq('thread_id', threadId).order('sent_at', { ascending: false }).limit(6);
  return (data || []).map((m) => (m.body_text || '').slice(0, 700)).filter((x) => x.length > 60).slice(0, 3);
}
// Die ganze FAQ aus Notion (wie beim Website-Chatbot), wird zwischengespeichert und ist deshalb schnell
async function knowledgeFull(db) {
  const { data } = await db.from('knowledge').select('content').limit(5);
  const notion = (data || []).map((r) => r.content).join('\n\n').slice(0, 70000);
  return notion ? `${BASE_FACTS}\n\nFAQ aus Notion (gilt vorrangig, auch für alle Preise):\n${notion}` : BASE_FACTS;
}
// Fester Teil (gleich für alle Anfragen, damit er zwischengespeichert werden kann)
function draftSystem(st, kb) {
  return `Du schreibst E-Mail-Antworten für Klaus von Loft Studio Cologne. Deutsch, natürlich, freundlich und klar, wie ein Mensch, nicht wie ein Callcenter.
So gehst du vor:
1. Prüfe zuerst in der FAQ, ob das Vorhaben bei uns überhaupt erlaubt ist (z. B. Musikvideos, laute Produktionen, Uhrzeiten). Ist es nicht erlaubt, sag das klar und freundlich in ein bis zwei Sätzen. Erwähne eine Alternative höchstens in einem Satz.
2. Finde alle Fragen in der Mail des Kunden, auch versteckte (z. B. "geht auch nachts?", "ist Licht dabei?").
3. Beantworte genau diese Fragen, in der Reihenfolge des Kunden, jeweils in ein bis zwei Sätzen.
4. Ende mit einem Satz zum nächsten Schritt.
WICHTIG: Gibt Klaus einen Änderungswunsch, setzt du ihn vollständig und sichtbar um. Sein Wunsch geht allen Regeln hier vor (Länge, Preise, Inhalt, Ton) und auch der FAQ und den Hausregeln: Klaus ist der Inhaber und darf Ausnahmen machen (z. B. Kulanz für Stammkunden oder Start-ups, früher anfangen zum gleichen Preis, Sonderpreis). Was er sagt, gilt als Tatsache. Formuliere eine solche Ausnahme freundlich als Entgegenkommen. Selbst erfindest du nichts dazu.
Länge ohne Änderungswunsch: höchstens etwa 100 Wörter ohne Signatur. Nach der Begrüßung direkt zur Sache. Kein Dank für Selbstverständliches (z. B. nicht für Kurzfristigkeit), keine Floskeln wie "gern prüfe ich das". Keine Telefonnummer oder Kontaktdaten im Text, außer der Kunde fragt danach (in der Signatur stehen sie ohnehin). Hausregeln setzt du in einem kurzen Satz um, ohne lange Erklärung. Keine Preislisten: nenne nur den Preis, der zur Anfrage passt (z. B. die gewünschte Stundenzahl), und nur wenn nach Preis oder Buchung gefragt ist oder eine Hausregel es verlangt. Was nicht gefragt ist, lässt du weg. Klaus kann später mehr verlangen.
Regeln:
- Nutze die FAQ unten. Nenne Preise, Zeiten und Konditionen genau so, wie sie dort stehen. Erfinde nichts. Weißt du etwas nicht (steht nicht in FAQ, Hausregeln oder Kalender), sag es ehrlich in einem natürlichen Satz, z. B. "Ob ein Generator auf dem Gelände möglich ist, kläre ich und gebe Ihnen Bescheid." Keine Platzhalter in eckigen Klammern.
- Verfügbarkeit: Steht in der Anfrage ein Kalenderstand, nutze ihn. Ist der Tag belegt: ein Satz ("Am Sonntag, 8.11. ist das Factory Loft leider schon belegt.") und direkt zwei Alternativtermine aus dem Kalenderstand anbieten. Keine weitere Erklärung, nichts zu Reservierung. Ist der Tag frei: ein Satz, dass er aktuell noch frei ist. Nenne nie, wer gebucht hat. Fragt der Kunde nach einem Zeitraum (z. B. "drei Tage Mitte Dezember"), such im Kalender-Überblick passende freie Tage und schlag sie konkret vor. Ist kein Kalender da oder ist der Wunsch unklar, verweise auf den Verfügbarkeitskalender: https://www.loftstudiocologne.com/verfuegbarkeit
- Zeiten und Preise genau: Übernimm Uhrzeiten und Dauer exakt so, wie der Kunde sie nennt, erfinde keine anderen. Nennt der Kunde einen Zeitrahmen und eine Dauer (z. B. "6 Stunden zwischen 9 und 16 Uhr"), ist die Dauer innerhalb des Rahmens gemeint. Dann ist die Dauer maßgeblich, und du kannst konkrete Zeiten vorschlagen (z. B. 9 bis 15 oder 10 bis 16 Uhr). Nennt er nur Uhrzeiten, rechne die Stunden selbst aus. Nimm den Preis exakt aus der Preistabelle der FAQ für genau diese Stundenzahl und Nutzungsart. Gibt es die Stundenzahl nicht als Paket, nenne das nächstgrößere Paket.
- Anrede einheitlich: Du-Form mit Vornamen ("Hallo Lena") oder Sie-Form mit Nachnamen ("Hallo Frau Brandt"), nie gemischt.
- Anrede: übernimm Du oder Sie vom Kunden. Ist das unklar, nimm "${st.tone === 'sie' ? 'Sie' : 'Du'}".
- Keine Gedankenstriche, keine Emojis, kein Markdown, keine Betreffzeile.
${st.rules ? `- Hausregeln von Klaus, immer befolgen (gehen allgemeinen Regeln vor):\n${st.rules}\n` : ''}- Beginne mit einer passenden Begrüßung mit Namen, ende mit genau dieser Signatur:
${st.signature}
- Gib nur den fertigen Mailtext aus, sonst nichts.

${kb}`;
}
export async function draftPrompt(db, threadId, variantKey, { current = '', instruction = '' } = {}) {
  const v = VARIANTS.find((x) => x.key === variantKey) || VARIANTS[0];
  const [{ t, msgs }, st, samples, kb] = await Promise.all([loadThread(db, threadId), settingsRow(db), styleSamples(db, threadId), knowledgeFull(db)]);
  const [cal1, cal2] = await Promise.all([availabilityForPrompt(t.requested_date, t.studio).catch(() => ''), overviewForPrompt().catch(() => '')]);
  const cal = [cal1, cal2].filter(Boolean).join('\n');
  const lastIn = [...msgs].reverse().find((m) => m.direction === 'in');
  if (!lastIn) throw Object.assign(new Error('Keine Kundenmail zum Beantworten'), { status: 409 });
  const head = `${todayLine()}
Kunde: ${t.contacts?.name || ''} <${t.contacts?.email || ''}>
Betreff: ${t.subject}
${t.summary ? 'Zusammenfassung: ' + t.summary + '\n' : ''}${cal ? cal + '\n' : ''}
Verlauf (neueste zuletzt):
${convoText(msgs)}
`;
  const prompt = instruction && current
    ? `ÄNDERUNGSWUNSCH VON KLAUS: ${instruction}

${head}
Aktueller Entwurf:
${current}

Überarbeite den Entwurf so, dass der Änderungswunsch "${instruction}" vollständig umgesetzt ist. Er hat Vorrang vor allen Regeln, vor der FAQ und den Hausregeln, auch wenn er eine Ausnahme ist. Der Unterschied zum alten Entwurf muss klar erkennbar sein. Alles, was der Wunsch nicht betrifft, bleibt wie es ist, auch die Signatur. Gib nur den fertigen Mailtext aus.`
    : `${head}
${samples.length ? 'So klingen Klaus’ bisherige Antworten (nur Ton übernehmen, keine Inhalte):\n' + samples.map((s, i) => `--- Beispiel ${i + 1} ---\n${s}`).join('\n') + '\n\n' : ''}${instruction ? 'Wunsch von Klaus für diese Antwort: ' + instruction + '\n' : ''}Schreibe die Antwort. ${v.hint}`;
  return { system: draftSystem(st, kb), prompt, position: 0, based_on: lastIn.sent_at, key: v.key };
}

export function parseDraft(raw, key) {
  let label = '', text = String(raw || '').replace(/```[a-z]*\n?/gi, '').trim();
  const m = text.match(/^\s*(?:LABEL|Label|Ansatz)\s*:\s*(.+)\n+/);
  if (m) { label = m[1].replace(/[*"]/g, '').trim(); text = text.slice(m[0].length); }
  else if (text.startsWith('{')) { try { const j = parseJson(text); label = j.label || ''; text = j.body || text; } catch (e) {} }
  let body = text.replace(/\s+—\s+|\s+–\s+/g, ', ').trim();
  if (!body) body = String(raw || '').replace(/^\s*(?:LABEL|Label|Ansatz)\s*:[^\n]*\n?/, '').trim(); // Rückfall: alles nehmen, was kam
  label = (label || 'KI-Vorschlag').slice(0, 30);
  return { label, body };
}
export async function saveDraft(db, threadId, d, raw) {
  const { label, body } = parseDraft(raw, d.key);
  if (!body) throw new Error('Die KI hat keinen Text geliefert (' + (d.diag || 'Länge ' + String(raw || '').length) + '). Bitte nochmal versuchen.');
  await db.from('drafts').delete().eq('thread_id', threadId).eq('position', d.position);
  await db.from('drafts').insert({ thread_id: threadId, label, body, position: d.position, based_on: d.based_on });
  return { label, body, position: d.position, based_on: d.based_on };
}
export async function draftVariant(db, threadId, variantKey) {
  const d = await draftPrompt(db, threadId, variantKey);
  const raw = await claude({ model: MODEL_WRITE, system: d.system, prompt: d.prompt, max_tokens: 1500, kind: 'Antwort' });
  return saveDraft(db, threadId, d, raw);
}
// Wort für Wort: liefert Text-Stücke, sobald die KI sie schreibt
export async function* claudeStream({ model = MODEL_WRITE, system, prompt, max_tokens = 1500, info = {}, kind = 'Antwort' }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY fehlt in Netlify'), { status: 409 });
  const r = await apiCall({ model, max_tokens, system: sys(system), stream: true, messages: [{ role: 'user', content: prompt }] },
    { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', accept: 'text/event-stream' });
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error('KI: ' + (j.error?.message || 'Fehler ' + r.status)); }
  info.types = new Set();
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  const handle = function* (line) {
    line = line.trim();
    if (!line.startsWith('data:')) return;
    let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (e) { return; }
    info.types.add(ev.type + (ev.delta?.type ? '/' + ev.delta.type : '') + (ev.content_block?.type ? '/' + ev.content_block.type : ''));
    if (ev.type === 'message_delta' && ev.delta?.stop_reason) info.stop = ev.delta.stop_reason;
    if (ev.type === 'message_start') info.model = ev.message?.model;
    if (ev.usage || ev.message?.usage) info.usage = { ...(info.usage || {}), ...(ev.message?.usage || {}), ...(ev.usage || {}) };
    if (ev.type === 'error') throw new Error('KI: ' + (ev.error?.message || 'Fehler'));
    if (ev.type === 'content_block_delta' && typeof ev.delta?.text === 'string') yield ev.delta.text;
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r/g, '');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); yield* handle(line); }
  }
  if (buf) yield* handle(buf);
  await logUsage(info.model || model, kind, info.usage);
}

export async function refineText(text, instruction) {
  const system = 'Du überarbeitest E-Mail-Entwürfe von Loft Studio Cologne. Behalte Inhalt, Fakten, Platzhalter in eckigen Klammern und die Signatur. Keine Gedankenstriche, kein Markdown. Gib nur den fertigen Mailtext zurück.';
  return claude({ model: MODEL_FAST, system, prompt: `Anweisung: ${instruction}\n\nEntwurf:\n${text}`, max_tokens: 900, kind: 'Ändern' });
}

// ---------- Fragen an die eigenen Anfragen ----------
const STOP = new Set('wer was wann wie wo wollte wollten nochmal noch mal das der die den dem des ein eine einen hat haben hatte ist sind war für mit und oder im in am an welche welcher welches gibt es uns ich wir zu von auf nach gefragt angefragt anfragen anfrage bei kann können zeige zeig alle letzte letzten'.split(' '));
export async function askInbox(db, question) {
  const words = question.toLowerCase().replace(/[^\p{L}\p{N}\s.]/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 6);
  const sel = 'id,subject,summary,status,last_message_at,contacts(name,email)';
  const found = new Map();
  for (const w of words) {
    const term = w.replace(/[%_,()]/g, '');
    const { data: a } = await db.from('threads').select(sel).or(`subject.ilike.%${term}%,summary.ilike.%${term}%`).eq('is_test', false).order('last_message_at', { ascending: false }).limit(25);
    (a || []).forEach((x) => found.set(x.id, x));
    const { data: m } = await db.from('messages').select('thread_id').ilike('body_text', `%${term}%`).limit(40);
    const ids = [...new Set((m || []).map((x) => x.thread_id))].filter((id) => !found.has(id)).slice(0, 25);
    if (ids.length) { const { data: b } = await db.from('threads').select(sel).in('id', ids).eq('is_test', false); (b || []).forEach((x) => found.set(x.id, x)); }
  }
  let list = [...found.values()];
  if (!list.length) { const { data } = await db.from('threads').select(sel).eq('kind', 'anfrage').eq('is_test', false).order('last_message_at', { ascending: false }).limit(30); list = data || []; }
  list = list.sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)).slice(0, 40);
  const ctx = list.map((x) => `[${x.id}] ${x.last_message_at.slice(0, 10)} · ${x.contacts?.name || x.contacts?.email} · ${x.subject} · ${x.status}${x.summary ? ' · ' + x.summary : ''}`).join('\n');
  const system = 'Du beantwortest Fragen von Klaus zu seinen Studio-Anfragen. Antworte kurz auf Deutsch, nur aus den Einträgen unten. Wenn nichts passt, sag das ehrlich. Keine Gedankenstriche. Antworte nur mit JSON.';
  const prompt = `${todayLine()}\nFrage: ${question}\n\nEinträge:\n${ctx}\n\nJSON: {"answer":"kurze Antwort","ids":["IDs der passenden Einträge, wichtigste zuerst"]}`;
  const r = (await claudeJson({ model: MODEL_FAST, system, prompt, max_tokens: 500, kind: 'Frage' }));
  const ids = (r.ids || []).filter((id) => found.has(id) || list.some((x) => x.id === id)).slice(0, 12);
  return { answer: String(r.answer || ''), ids };
}

// ---------- Testmodus ----------
const SCENARIOS = [
  'Fotografin will das Penthouse Loft für ein Fashion-Shooting an einem Samstag in 2 bis 3 Wochen, 8 Personen, fragt nach Tageslicht und Make-up-Raum.',
  'Coach sucht Raum für einen zweitägigen Workshop mit 14 Teilnehmenden im nächsten Monat, fragt nach Beamer, Flipchart und Catering.',
  'Band will ein Musikvideo drehen, Datum flexibel, fragt nur nach Preisen für Halbtag und Tag.',
  'Agentur fragt sehr kurzfristig für übermorgen nach dem Factory Loft für einen Produktshoot, 6 Personen.',
  'Privatperson will einen 40. Geburtstag mit 30 Gästen feiern (mehr als erlaubt), fragt nach Musik und Küche.',
  'Bestehende Kundin hat nächste Woche gebucht und fragt, ob sie eine Stunde früher zum Aufbauen kommen kann.',
  'Yoga-Lehrerin möchte vorher beide Lofts besichtigen, unentschlossen, kein Datum genannt.',
  'Filmproduktion fragt für 3 Drehtage, braucht Strom für großes Licht und Parkplätze für einen Sprinter.',
];
export async function generateTestInquiry() {
  const scenario = SCENARIOS[Math.floor(Math.random() * SCENARIOS.length)];
  const system = 'Du erfindest realistische, deutschsprachige Kunden-E-Mails an Loft Studio Cologne für Testzwecke. Die Person ist frei erfunden. Schreibe natürlich, mit Begrüßung und kurzer Signatur, gern mit kleinen Eigenheiten. Antworte nur mit JSON.';
  const prompt = `${todayLine()}\nSzenario: ${scenario}\nJSON: {"name":"Vor- und Nachname","email":"name@example.com (Domain muss example.com sein)","subject":"Betreff","body":"Mailtext"}`;
  const r = (await claudeJson({ model: MODEL_FAST, system, prompt, max_tokens: 700, kind: 'Testmodus' }));
  const local = String(r.email || 'test').split('@')[0].toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'test';
  return { name: String(r.name || 'Test Kundin').slice(0, 80), email: `${local}.${Math.random().toString(36).slice(2, 6)}@example.com`, subject: String(r.subject || 'Anfrage').slice(0, 200), body: String(r.body || '') };
}
export async function generateTestReply(db, threadId) {
  const { t, msgs } = await loadThread(db, threadId);
  const moods = ['sagt zu und bittet um das Angebot', 'hat eine Rückfrage', 'nennt ein anderes Datum', 'bedankt sich und bucht verbindlich', 'sagt freundlich ab, weil es zu teuer ist', 'fragt nach einer Besichtigung'];
  const mood = moods[Math.floor(Math.random() * moods.length)];
  const system = `Du spielst die erfundene Kundin/den erfundenen Kunden ${t.contacts?.name} in einem Mailverlauf mit Loft Studio Cologne. Antworte realistisch und kurz auf die letzte Nachricht des Studios, auf Deutsch. Antworte nur mit JSON.`;
  const prompt = `Verlauf:\n${convoText(msgs, 8)}\n\nDeine Reaktion: Du ${mood}.\nJSON: {"body":"Mailtext mit Begrüßung und Gruß"}`;
  const r = (await claudeJson({ model: MODEL_FAST, system, prompt, max_tokens: 500, kind: 'Testmodus' }));
  return String(r.body || '');
}
export { MAILBOX };
