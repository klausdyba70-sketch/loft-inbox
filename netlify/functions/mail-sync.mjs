// Automatischer Mailabruf alle 5 Minuten
import { admin } from '../lib/core.mjs';
import { runSync } from '../lib/sync.mjs';
export default async () => {
  const db = admin();
  const { data } = await db.from('ms_auth').select('id').maybeSingle();
  if (!data) { console.log('Microsoft noch nicht verbunden, nichts zu tun'); return; }
  try { console.log('Mailabruf', JSON.stringify(await runSync(db))); }
  catch (e) {
    console.error('Mailabruf fehlgeschlagen', e);
    await db.from('sync_state').upsert({ key: 'graph:last_error', value: { at: new Date().toISOString(), message: String(e.message || e) }, updated_at: new Date().toISOString() });
  }
};
export const config = { schedule: '*/5 * * * *' };
