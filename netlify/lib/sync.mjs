// Mailabruf über Microsoft Graph (Delta-Abfragen) und Ablage in Supabase
import { graph, msAccessToken, MAILBOX } from './core.mjs';

const SELECT = 'id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,bodyPreview,isRead';
const FOLDERS = ['inbox', 'sentitems'];
const MAX_PAGES_PER_RUN = 20; // hält jeden Lauf kurz; der Rest folgt beim nächsten Lauf

// HTML grob in lesbaren Text umwandeln (für Suche, KI und Vorschau)
export function htmlToText(html) {
  if (!html) return '';
  if (!/<[a-z!][\s\S]*>/i.test(html)) return html;
  let t = html.replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n').replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  return t.split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const MAX_HTML = 400_000;

export const cleanSubject = (s) => (s || '').replace(/^\s*((re|aw|wg|fw|fwd|antw)\s*:\s*)+/i, '').trim() || '(ohne Betreff)';

// Trennt Signatur und zitierten Verlauf grob ab, damit der Verlauf lesbar bleibt
export function splitBody(text) {
  let t = (text || '').replace(/\r\n/g, '\n');
  const cut = t.search(/\n(?:-{2,}\s*Original|Von:\s.+\n(?:Gesendet|Datum):|From:\s.+\n(?:Sent|Date):|Am .{5,80} schrieb .{1,80}:|On .{5,80} wrote:)/i);
  if (cut > 0) t = t.slice(0, cut);
  return t.trim();
}

export function mapMessage(m) {
  const from = (m.from?.emailAddress?.address || '').toLowerCase();
  const out = from === MAILBOX;
  const to = (m.toRecipients || []).map((r) => r.emailAddress?.address?.toLowerCase()).filter(Boolean);
  const counterpart = out ? to.find((a) => a !== MAILBOX) || to[0] || '' : from;
  const counterpartName = out
    ? (m.toRecipients || []).find((r) => r.emailAddress?.address?.toLowerCase() === counterpart)?.emailAddress?.name
    : m.from?.emailAddress?.name;
  return {
    out,
    counterpart,
    counterpartName: counterpartName && counterpartName.toLowerCase() !== counterpart ? counterpartName : null,
    conversationId: m.conversationId,
    message: {
      graph_id: m.id,
      message_id: m.internetMessageId || null,
      direction: out ? 'out' : 'in',
      from_addr: from,
      to_addr: to.join(', '),
      cc: (m.ccRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean).join(', ') || null,
      subject: m.subject || null,
      body_text: splitBody(m.body?.contentType === 'html' ? htmlToText(m.body.content) : m.body?.content || m.bodyPreview || ''),
      body_html: m.body?.contentType === 'html' && m.body.content.length < MAX_HTML ? m.body.content : null,
      sent_at: m.sentDateTime || m.receivedDateTime,
    },
    subject: cleanSubject(m.subject),
  };
}

async function upsertContact(db, email, name) {
  const { data: found } = await db.from('contacts').select('id,name').ilike('email', email).maybeSingle();
  if (found) {
    if (!found.name && name) await db.from('contacts').update({ name }).eq('id', found.id);
    return found.id;
  }
  const { data, error } = await db.from('contacts').insert({ email, name, source: 'mail' }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function storeMessage(db, raw) {
  const m = mapMessage(raw);
  if (!m.counterpart || !m.conversationId) return 'übersprungen';
  const { data: dup } = await db.from('messages').select('id').eq('graph_id', m.message.graph_id).maybeSingle();
  if (dup) return 'doppelt';
  if (m.message.message_id) {
    const { data: dup2 } = await db.from('messages').select('id').eq('message_id', m.message.message_id).maybeSingle();
    if (dup2) return 'doppelt';
  }
  const contactId = await upsertContact(db, m.counterpart, m.counterpartName);
  let { data: thread } = await db.from('threads').select('*').eq('conversation_id', m.conversationId).maybeSingle();
  const at = m.message.sent_at;
  if (!thread) {
    const { data, error } = await db.from('threads').insert({
      conversation_id: m.conversationId, contact_id: contactId, subject: m.subject,
      status: m.out ? 'beantwortet' : 'offen', unread: !m.out, last_message_at: at,
    }).select('*').single();
    if (error) throw error;
    thread = data;
  }
  const { error: mErr } = await db.from('messages').insert({ ...m.message, thread_id: thread.id });
  if (mErr) throw mErr;

  const patch = {};
  if (new Date(at) > new Date(thread.last_message_at)) patch.last_message_at = at;
  if (m.out) {
    // Nur wenn unsere Antwort die neueste Nachricht ist. Kam danach schon eine Kundenmail, bleibt die Anfrage offen.
    if (thread.status === 'offen' && new Date(at) >= new Date(thread.last_message_at)) patch.status = 'beantwortet';
    if (thread.first_response_minutes == null) {
      const { data: firstIn } = await db.from('messages').select('sent_at').eq('thread_id', thread.id).eq('direction', 'in').order('sent_at').limit(1).maybeSingle();
      if (firstIn) patch.first_response_minutes = Math.max(0, Math.round((new Date(at) - new Date(firstIn.sent_at)) / 60000));
    }
  } else if (new Date(at) >= new Date(thread.last_message_at)) {
    if (thread.status !== 'spam') patch.status = 'offen';
    patch.unread = true;
    patch.ai_at = null;
  }
  if (Object.keys(patch).length) await db.from('threads').update(patch).eq('id', thread.id);
  return 'neu';
}

// budgetMs: Zeitbudget pro Lauf. Netlify beendet normale Funktionen nach ca. 10 s, geplante nach 30 s.
// 1) Zuerst immer die neuesten Mails holen (damit Neues sofort erscheint),
// 2) danach mit der restlichen Zeit ältere Mails nachladen (Delta-Abfrage).
export async function runSync(db, { budgetMs = 8000 } = {}) {
  const started = Date.now();
  const timeLeft = () => Date.now() - started < budgetMs;
  const token = await msAccessToken(db);
  const result = {};
  const H = { headers: { Prefer: 'outlook.body-content-type="html"' } };

  // ---- 1) Neueste Mails ----
  for (const folder of FOLDERS) {
    const key = `graph:recent:${folder}`;
    const { data: st } = await db.from('sync_state').select('value').eq('key', key).maybeSingle();
    const since = st?.value?.since || new Date(Date.now() - 3 * 864e5).toISOString();
    const field = folder === 'sentitems' ? 'sentDateTime' : 'receivedDateTime';
    const url = `/me/mailFolders/${folder}/messages?$select=${SELECT}&$filter=${field} ge ${since}&$orderby=${field} desc&$top=30`;
    const counts = { neu: 0, doppelt: 0, übersprungen: 0 };
    let newest = since;
    const res = await graph(token, url, H);
    for (const m of res.value || []) {
      counts[await storeMessage(db, m)]++;
      const t = m[field] || m.receivedDateTime; if (t && t > newest) newest = t;
    }
    // eine Stunde Überlappung, damit nichts durchrutscht; Doppelte werden erkannt
    const next = new Date(Math.max(new Date(since).getTime(), new Date(newest).getTime() - 36e5)).toISOString();
    await db.from('sync_state').upsert({ key, value: { since: next }, updated_at: new Date().toISOString() });
    result[folder] = { ...counts };
  }

  // ---- 2) Ältere Mails nachladen ----
  for (const folder of FOLDERS) {
    const key = `graph:${folder}`;
    const { data: st } = await db.from('sync_state').select('value').eq('key', key).maybeSingle();
    let url = st?.value?.next || st?.value?.delta || `/me/mailFolders/${folder}/messages/delta?$select=${SELECT}`;
    const counts = result[folder];
    let pages = 0;
    for (; pages < MAX_PAGES_PER_RUN && url && timeLeft(); pages++) {
      const res = await graph(token, url, { headers: { Prefer: 'outlook.body-content-type="html", odata.maxpagesize=10' } });
      for (const m of res.value || []) {
        if (m['@removed']) continue;
        counts[await storeMessage(db, m)]++;
      }
      const saved = res['@odata.nextLink'] ? { next: res['@odata.nextLink'] } : { delta: res['@odata.deltaLink'] };
      url = saved.next || null;
      await db.from('sync_state').upsert({ key, value: saved, updated_at: new Date().toISOString() });
    }
    counts.fertig = !url && pages > 0 ? true : !(st?.value?.next) && !url;
    counts.nachladen = !!url || !!(pages === 0 && st?.value?.next);
  }
  await db.from('sync_state').upsert({ key: 'graph:last_run', value: { at: new Date().toISOString(), result }, updated_at: new Date().toISOString() });
  return result;
}
