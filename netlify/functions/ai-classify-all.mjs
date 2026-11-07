// Alle noch nicht eingestuften Mails im Hintergrund einstufen (Anfrage, Sonstiges, Werbung, Spam).
// Nur lesen und in der App markieren, am Postfach ändert sich nichts. Setzt sich selbst fort.
import { createHash } from 'node:crypto';
import { requireOwner, admin } from '../lib/core.mjs';
import { classifyThread } from '../lib/ai.mjs';

const KEY = 'ai:classify-all';
const internalToken = () => createHash('sha256').update('classify-continue:' + (process.env.SUPABASE_SECRET_KEY || '')).digest('hex');

export default async (req) => {
  let db;
  try {
    if (req.headers.get('x-loft-internal') === internalToken()) db = admin(); else ({ db } = await requireOwner(req));
    const put = (v) => db.from('sync_state').upsert({ key: KEY, value: { ...v, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
    const { data: prev } = await db.from('sync_state').select('value').eq('key', KEY).maybeSingle();
    if (!req.headers.get('x-loft-internal') && prev?.value?.status === 'läuft' && Date.now() - new Date(prev.value.at).getTime() < 120000) return;
    const { count: total } = await db.from('threads').select('id', { count: 'exact', head: true }).is('ai_at', null).eq('is_test', false);
    const st = { status: 'läuft', done: prev?.value?.status === 'läuft' || prev?.value?.status === 'pausiert' ? prev.value.done || 0 : 0, errors: 0, left: total || 0 };
    await put(st);
    const started = Date.now(), cutoff = Date.now() - 30 * 864e5;
    while (Date.now() - started < 11 * 60000) {
      const { data: batch } = await db.from('threads').select('id,last_message_at').is('ai_at', null).eq('is_test', false).order('last_message_at', { ascending: false }).limit(8);
      if (!batch?.length) { st.status = 'fertig'; st.left = 0; await put(st); return; }
      await Promise.all(batch.map(async (t) => {
        try { await classifyThread(db, t.id, { old: new Date(t.last_message_at).getTime() < cutoff }); st.done++; }
        catch (e) { st.errors++; st.lastError = e.message; await db.from('threads').update({ ai_at: new Date().toISOString() }).eq('id', t.id); } // nicht endlos wiederholen
      }));
      st.left = Math.max(0, (total || 0) - st.done); await put(st);
    }
    st.status = 'pausiert'; await put(st);
    const base = process.env.DEPLOY_PRIME_URL || process.env.URL;
    if (base) await fetch(`${base}/api/ai/classify-all`, { method: 'POST', headers: { 'x-loft-internal': internalToken() }, body: '{}' }).catch(() => {});
  } catch (e) { console.error('Einstufen:', e.message); }
};
export const config = { path: '/api/ai/classify-all', background: true };
