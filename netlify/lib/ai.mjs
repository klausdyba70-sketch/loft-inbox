// KI für die Loft Inbox: Einstufung, Antwortvorschläge, Verfeinern, Fragen, Testmodus
import { MAILBOX } from './core.mjs';

const MODEL_FAST = process.env.AI_MODEL_FAST || 'claude-haiku-5-5';
const MODEL_WRITE = process.env.AI_MODEL_WRITE || 'claude-haiku-5-5';
const NOTION_PAGE = process.env.NOTION_PAGE_ID || '1f2dc5aac79d80d38d23d7639ee9be8d';
export const CATS = ['Verfügbarkeit', 'Preis', 'Besichtigung', 'Buchung', 'Workshop / Seminar', 'Event', 'Ausstattung', 'Sonstiges'];
const WD = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// Grundwissen, falls Notion (noch) nicht verbunden ist. Preise stehen bewusst NICHT hier.
const BASE_FACTS = `Loft Studio Cologne, Köln. Zwei Mietstudios:
- Factory Loft: Foto, Film, Seminare und Workshops. 4 Tische à 4 Personen, 16 Stühle, max. 16 Personen. Styling- und Make-up-Ecke.
- Penthouse Loft: max. 20 Personen. Küche mit Kapselmaschine (kompostierbare Kapseln) und Milchschäumer. Make-up-Raum. Bad mit Dusche im WC.
- Beide Lofts zusammen ca. 180 m², davon ca. 120 m² Arbeitsraum.
- Keine Vorauszahlung, die Rechnung kommt nach der Miete. Eigenes Catering ist möglich.
- Equipment wird nicht vermietet, C-Stands kostenfrei auf Anfrage.`;

export async function claude({ model = MODEL_FAST, system, prompt, max_tokens = 1000, temperature = 0.3 }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error('ANTHROPIC_API_KEY fehlt in Netlify'), { status: 409 });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens, temperature, system, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('KI: ' + (j.error?.message || 'Fehler ' + r.status)), { status: r.status === 401 ? 409 : 502 });
  return (j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('').trim();
}
export function parseJson(t) {
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('KI-Antwort ohne JSON');
  return JSON.parse(t.slice(a, b + 1));
}
const todayLine = () => { const d = new Date(); return `Heute ist ${WD[d.getDay()]}, der ${d.toISOString().slice(0, 10)}.`; };

// ---------- Wissen aus Notion ----------
async function notionBlocks(id, token, depth = 0, out = []) {
  let cursor = null;
  do {
    const u = `https://api.notion.com/v1/blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`;
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + token, 'Notion-Version': '2022-06-28' } });
    const j = await r.json();
    if (!r.ok) throw new Error('Notion: ' + (j.message || r.status));
    for (const b of j.results || []) {
      const d = b[b.type] || {};
      const txt = (d.rich_text || []).map((x) => x.plain_text).join('');
      if (b.type === 'table_row') out.push((d.cells || []).map((c) => c.map((x) => x.plain_text).join('')).join(' | '));
      else if (txt) out.push((b.type.startsWith('heading') ? '\n## ' : b.type.includes('list_item') || b.type === 'to_do' ? '- ' : '') + txt);
      if (b.has_children && depth < 4 && b.type !== 'child_page' && b.type !== 'child_database') await notionBlocks(b.id, token, depth + 1, out);
    }
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return out;
}
export async function refreshKnowledge(db, force = false) {
  const token = process.env.NOTION_TOKEN;
  if (!token) return { ok: false, reason: 'NOTION_TOKEN fehlt' };
  const { data: k } = await db.from('knowledge').select('synced_at').eq('id', NOTION_PAGE).maybeSingle();
  if (!force && k && Date.now() - new Date(k.synced_at).getTime() < 6 * 36e5) return { ok: true, synced_at: k.synced_at };
  const lines = await notionBlocks(NOTION_PAGE, token);
  const content = lines.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 60000);
  const synced_at = new Date().toISOString();
  await db.from('knowledge').upsert({ id: NOTION_PAGE, title: 'Loft Studio Cologne FAQ (Notion)', content, synced_at });
  return { ok: true, synced_at, chars: content.length };
}
async function knowledge(db) {
  const { data } = await db.from('knowledge').select('content').limit(5);
  const notion = (data || []).map((r) => r.content).join('\n\n').slice(0, 40000);
  return notion ? `${BASE_FACTS}\n\nAktuelle Infos aus Notion (diese gelten vorrangig, auch für Preise):\n${notion}` : BASE_FACTS;
}

// ---------- Verlauf laden ----------
async function loadThread(db, threadId) {
  const { data: t } = await db.from('threads').select('id,subject,status,studio,category,priority,ai_at,is_test,summary,contacts(name,email)').eq('id', threadId).maybeSingle();
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
  const r = parseJson(await claude({ model: MODEL_FAST, system, prompt, max_tokens: 400, temperature: 0 }));
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
  { key: 'direkt', hint: 'Kurz und direkt: beantwortet die Frage klar, schlägt den nächsten Schritt vor (z. B. Angebot schicken, Termin reservieren). 3 bis 6 Sätze.' },
  { key: 'ausfuehrlich', hint: 'Ausführlich und herzlich: beantwortet alle Fragen mit den passenden Fakten zum Loft, nennt Ablauf und Konditionen, lädt zur Besichtigung ein.' },
  { key: 'rueckfrage', hint: 'Rückfrage oder Alternative: fragt gezielt nach fehlenden Angaben (Datum, Uhrzeit, Personen, Art der Produktion) oder bietet eine Alternative an, falls etwas unklar oder nicht möglich ist.' },
];
async function settingsRow(db) {
  const { data } = await db.from('settings').select('tone,signature').eq('id', true).maybeSingle();
  return data || { tone: 'du', signature: 'Viele Grüße\nKlaus\nLoft Studio Cologne' };
}
async function styleSamples(db, threadId) {
  const { data } = await db.from('messages').select('body_text,thread_id').eq('direction', 'out').neq('thread_id', threadId).order('sent_at', { ascending: false }).limit(6);
  return (data || []).map((m) => (m.body_text || '').slice(0, 700)).filter((x) => x.length > 60).slice(0, 4);
}
export async function draftVariant(db, threadId, variantKey) {
  const v = VARIANTS.find((x) => x.key === variantKey) || VARIANTS[0];
  const [{ t, msgs }, st, kb, samples] = await Promise.all([loadThread(db, threadId), settingsRow(db), knowledge(db), styleSamples(db, threadId)]);
  const lastIn = [...msgs].reverse().find((m) => m.direction === 'in');
  if (!lastIn) throw Object.assign(new Error('Keine Kundenmail zum Beantworten'), { status: 409 });
  const system = `Du schreibst E-Mail-Antworten für Klaus von Loft Studio Cologne. Deutsch, natürlich, freundlich und klar, wie ein Mensch, nicht wie ein Callcenter.
Regeln:
- Nutze nur Fakten aus dem Wissen unten. Erfinde keine Preise, Zeiten oder Zusagen. Fehlt eine Angabe, setze einen Platzhalter in eckigen Klammern, z. B. [Preis Tagesmiete] oder [Verfügbarkeit prüfen].
- Bestätige keine Verfügbarkeit als sicher, außer der Verlauf sagt es. Formuliere sonst z. B. "Ich schaue gleich in den Kalender" oder setze [Verfügbarkeit prüfen].
- Anrede: übernimm Du oder Sie vom Kunden. Ist das unklar, nimm "${st.tone === 'sie' ? 'Sie' : 'Du'}".
- Keine Gedankenstriche, keine Emojis, kein Markdown, keine Betreffzeile.
- Beginne mit einer passenden Begrüßung mit Namen, ende mit genau dieser Signatur:
${st.signature}

Wissen:
${kb}`;
  const prompt = `${todayLine()}
Kunde: ${t.contacts?.name || ''} <${t.contacts?.email || ''}>
Betreff: ${t.subject}
${t.summary ? 'Zusammenfassung: ' + t.summary + '\n' : ''}
Verlauf (neueste zuletzt):
${convoText(msgs)}

${samples.length ? 'So klingen Klaus’ bisherige Antworten (nur Ton übernehmen, keine Inhalte):\n' + samples.map((s, i) => `--- Beispiel ${i + 1} ---\n${s}`).join('\n') + '\n\n' : ''}Schreibe EINE Antwort im Stil: ${v.hint}
Antworte nur mit JSON: {"label":"2 bis 3 Wörter, die den Ansatz benennen","body":"vollständiger Mailtext"}`;
  const r = parseJson(await claude({ model: MODEL_WRITE, system, prompt, max_tokens: 900, temperature: 0.6 }));
  const body = String(r.body || '').replace(/\s+—\s+|\s+–\s+/g, ', ').trim();
  const label = String(r.label || v.key).slice(0, 30);
  const position = VARIANTS.indexOf(v);
  await db.from('drafts').delete().eq('thread_id', threadId).eq('position', position);
  await db.from('drafts').insert({ thread_id: threadId, label, body, position, based_on: lastIn.sent_at });
  return { label, body, position, based_on: lastIn.sent_at };
}

export async function refineText(text, instruction) {
  const system = 'Du überarbeitest E-Mail-Entwürfe von Loft Studio Cologne. Behalte Inhalt, Fakten, Platzhalter in eckigen Klammern und die Signatur. Keine Gedankenstriche, kein Markdown. Gib nur den fertigen Mailtext zurück.';
  return claude({ model: MODEL_FAST, system, prompt: `Anweisung: ${instruction}\n\nEntwurf:\n${text}`, max_tokens: 900, temperature: 0.4 });
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
  const r = parseJson(await claude({ model: MODEL_FAST, system, prompt, max_tokens: 500, temperature: 0 }));
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
  const r = parseJson(await claude({ model: MODEL_FAST, system, prompt, max_tokens: 700, temperature: 0.9 }));
  const local = String(r.email || 'test').split('@')[0].toLowerCase().replace(/[^a-z0-9.-]/g, '') || 'test';
  return { name: String(r.name || 'Test Kundin').slice(0, 80), email: `${local}.${Math.random().toString(36).slice(2, 6)}@example.com`, subject: String(r.subject || 'Anfrage').slice(0, 200), body: String(r.body || '') };
}
export async function generateTestReply(db, threadId) {
  const { t, msgs } = await loadThread(db, threadId);
  const moods = ['sagt zu und bittet um das Angebot', 'hat eine Rückfrage', 'nennt ein anderes Datum', 'bedankt sich und bucht verbindlich', 'sagt freundlich ab, weil es zu teuer ist', 'fragt nach einer Besichtigung'];
  const mood = moods[Math.floor(Math.random() * moods.length)];
  const system = `Du spielst die erfundene Kundin/den erfundenen Kunden ${t.contacts?.name} in einem Mailverlauf mit Loft Studio Cologne. Antworte realistisch und kurz auf die letzte Nachricht des Studios, auf Deutsch. Antworte nur mit JSON.`;
  const prompt = `Verlauf:\n${convoText(msgs, 8)}\n\nDeine Reaktion: Du ${mood}.\nJSON: {"body":"Mailtext mit Begrüßung und Gruß"}`;
  const r = parseJson(await claude({ model: MODEL_FAST, system, prompt, max_tokens: 500, temperature: 0.9 }));
  return String(r.body || '');
}
export { MAILBOX };
