// Import der Antworten aus Freshdesk (nur lesen bei Freshdesk). Die Anfragen selbst liegen schon im Postfach,
// es fehlen dort aber die Antworten, die Freshdesk über den eigenen Server verschickt hat.
import { MAILBOX } from './core.mjs';
import { htmlToText, splitBody, cleanSubject } from './sync.mjs';

const STATE = 'freshdesk:import';
const DOMAIN = () => (process.env.FRESHDESK_DOMAIN || 'loftstudiocologne.freshdesk.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fd(path) {
  const key = process.env.FRESHDESK_API_KEY;
  if (!key) throw Object.assign(new Error('FRESHDESK_API_KEY fehlt in Netlify'), { status: 409 });
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(`https://${DOMAIN()}/api/v2${path}`, {
      headers: { authorization: 'Basic ' + Buffer.from(key + ':X').toString('base64'), 'content-type': 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (r.status === 429) { await sleep((Number(r.headers.get('retry-after')) || 30) * 1000); continue; } // Ratenbegrenzung abwarten
    if (r.status === 401) throw new Error('Freshdesk lehnt den API-Schlüssel ab. Bitte in Netlify prüfen.');
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Freshdesk antwortet mit ' + r.status);
    return r.json();
  }
  throw new Error('Freshdesk ist gerade überlastet. Später nochmal versuchen.');
}

export async function getState(db) {
  const { data } = await db.from('sync_state').select('value').eq('key', STATE).maybeSingle();
  return data?.value || null;
}
const putState = (db, value) => db.from('sync_state').upsert({ key: STATE, value: { ...value, at: new Date().toISOString() }, updated_at: new Date().toISOString() });

async function contactFor(db, email, name, fdId) {
  const { data: found } = await db.from('contacts').select('id,name').ilike('email', email).maybeSingle();
  if (found) { if (!found.name && name) await db.from('contacts').update({ name }).eq('id', found.id); return found.id; }
  const { data, error } = await db.from('contacts').insert({ email, name, source: 'freshdesk', freshdesk_id: fdId || null }).select('id').single();
  if (error) throw error;
  return data.id;
}

// Passende Anfrage aus dem Postfach finden: gleiche Adresse, Kundenmail nahe am Ticket-Zeitpunkt, Betreff bevorzugt
async function findThread(db, contactId, ticket) {
  const { data: th } = await db.from('threads').select('id,subject,freshdesk_id').eq('contact_id', contactId).limit(200);
  if (!th?.length) return null;
  const byFd = th.find((x) => x.freshdesk_id === ticket.id); if (byFd) return byFd.id;
  const t0 = new Date(ticket.created_at).getTime();
  const { data: ms } = await db.from('messages').select('thread_id,sent_at').in('thread_id', th.map((x) => x.id)).eq('direction', 'in')
    .gte('sent_at', new Date(t0 - 3 * 864e5).toISOString()).lte('sent_at', new Date(t0 + 3 * 864e5).toISOString());
  const subj = cleanSubject(ticket.subject).toLowerCase();
  let best = null, bestScore = -1;
  for (const m of ms || []) {
    const t = th.find((x) => x.id === m.thread_id);
    const score = (cleanSubject(t.subject).toLowerCase() === subj ? 10 : 0) - Math.abs(new Date(m.sent_at).getTime() - t0) / 864e5;
    if (score > bestScore) { bestScore = score; best = t.id; }
  }
  if (best) return best;
  return th.find((x) => cleanSubject(x.subject).toLowerCase() === subj)?.id || null;
}

async function importTicket(db, ticket, counts) {
  const email = (ticket.requester?.email || '').toLowerCase();
  if (!email || email === MAILBOX) { counts.skipped++; return; }
  const convs = [];
  for (let page = 1; page < 10; page++) {
    const list = await fd(`/tickets/${ticket.id}/conversations?per_page=100&page=${page}`) || [];
    convs.push(...list); if (list.length < 100) break;
  }
  const replies = convs.filter((c) => !c.incoming && !c.private);
  const contactId = await contactFor(db, email, ticket.requester?.name || null, ticket.requester?.id);
  let threadId = await findThread(db, contactId, ticket);
  let created = false;
  if (!threadId) {
    // Anfrage nicht im Postfach (z. B. über das Kontaktformular gekommen): ganz anlegen
    const { data, error } = await db.from('threads').insert({ contact_id: contactId, subject: cleanSubject(ticket.subject), status: 'offen', unread: false, last_message_at: ticket.created_at, freshdesk_id: ticket.id }).select('id').single();
    if (error) throw error;
    threadId = data.id; created = true; counts.newThreads++;
    await db.from('messages').insert({ thread_id: threadId, direction: 'in', from_addr: email, to_addr: MAILBOX, subject: ticket.subject, body_text: splitBody(ticket.description_text || htmlToText(ticket.description || '')), body_html: ticket.description || null, sent_at: ticket.created_at, message_id: `freshdesk-ticket-${ticket.id}@loftinbox` }).then(() => {}, () => {});
  } else {
    await db.from('threads').update({ freshdesk_id: ticket.id }).eq('id', threadId).is('freshdesk_id', null).then(() => {}, () => {});
  }
  // Antworten (und bei neu angelegten Anfragen auch spätere Kundenmails) übernehmen
  const take = created ? convs.filter((c) => !c.private) : replies;
  for (const c of take) {
    const { data: dup } = await db.from('messages').select('id').eq('freshdesk_id', c.id).maybeSingle();
    if (dup) continue;
    const out = !c.incoming;
    const { error } = await db.from('messages').insert({
      thread_id: threadId, direction: out ? 'out' : 'in', from_addr: out ? MAILBOX : email, to_addr: out ? email : MAILBOX,
      subject: ticket.subject, body_text: splitBody(c.body_text || htmlToText(c.body || '')), body_html: c.body && c.body.length < 400000 ? c.body : null,
      sent_at: c.created_at, freshdesk_id: c.id,
    });
    if (!error && out) counts.replies++;
  }
  // Status und Zeiten der Anfrage neu bestimmen
  const { data: all } = await db.from('messages').select('direction,sent_at').eq('thread_id', threadId).order('sent_at');
  if (!all?.length) return;
  const last = all[all.length - 1], firstIn = all.find((m) => m.direction === 'in'), firstOut = all.find((m) => m.direction === 'out');
  const { data: t } = await db.from('threads').select('status,first_response_minutes').eq('id', threadId).single();
  const patch = { last_message_at: last.sent_at };
  if (firstIn && firstOut && t.first_response_minutes == null && firstOut.sent_at > firstIn.sent_at) patch.first_response_minutes = Math.round((new Date(firstOut.sent_at) - new Date(firstIn.sent_at)) / 60000);
  const resolved = ticket.status === 4 || ticket.status === 5;
  const lastAfterTicket = new Date(last.sent_at).getTime() > new Date(ticket.updated_at).getTime() + 864e5;
  if (t.status !== 'spam') {
    if (last.direction === 'out') { patch.status = resolved ? 'abgeschlossen' : (t.status === 'offen' ? 'beantwortet' : t.status); patch.unread = false; }
    else if (resolved && !lastAfterTicket) { patch.status = 'abgeschlossen'; patch.unread = false; }
  }
  await db.from('threads').update(patch).eq('id', threadId);
}

// Läuft bis budgetMs, speichert den Stand und kann danach fortgesetzt werden
export async function runImport(db, { budgetMs = 12 * 60000, years = 2 } = {}) {
  const started = Date.now();
  let st = await getState(db);
  if (!st || st.status === 'fertig' && st.restart) st = null;
  st = st || { status: 'läuft', since: new Date(Date.now() - years * 365 * 864e5).toISOString(), page: 1, idx: 0, counts: { tickets: 0, replies: 0, newThreads: 0, skipped: 0, errors: 0 } };
  st.status = 'läuft'; st.error = null; await putState(db, st);
  try {
    while (Date.now() - started < budgetMs) {
      const list = await fd(`/tickets?updated_since=${encodeURIComponent(st.since)}&order_by=created_at&order_type=asc&per_page=100&page=${st.page}&include=requester`) || [];
      for (; st.idx < list.length; st.idx++) {
        if (Date.now() - started > budgetMs) { await putState(db, st); return st; }
        const tk = list[st.idx];
        if (tk.spam || new Date(tk.created_at) < new Date(st.since)) { st.counts.skipped++; continue; }
        try { await importTicket(db, tk, st.counts); st.counts.tickets++; }
        catch (e) { console.error('Ticket', tk.id, e.message); st.counts.errors++; st.lastTicketError = `#${tk.id}: ${e.message}`; }
        if (st.idx % 5 === 0) await putState(db, st);
      }
      if (list.length < 100) { st.status = 'fertig'; st.doneAt = new Date().toISOString(); await putState(db, st); return st; }
      st.page++; st.idx = 0; await putState(db, st);
      if (st.page > 300) { st.status = 'fertig'; st.note = 'Freshdesk liefert höchstens 300 Seiten'; await putState(db, st); return st; }
    }
  } catch (e) {
    st.status = 'pausiert'; st.error = e.message; await putState(db, st); throw e;
  }
  st.status = 'pausiert'; await putState(db, st);
  return st;
}
