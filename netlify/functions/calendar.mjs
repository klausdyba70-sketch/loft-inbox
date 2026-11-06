// Belegung der beiden Lofts lesen. Nur GET, nur lesen, nur für den Besitzer.
import { guard, json, requireOwner } from '../lib/core.mjs';
import { busy, dayStart } from '../lib/cal.mjs';

export default guard(async (req) => {
  if (req.method !== 'GET') return json({ error: 'Nur lesen' }, 405);
  await requireOwner(req);
  const u = new URL(req.url);
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const fromIso = ok(u.searchParams.get('from')) ? u.searchParams.get('from') : new Date().toISOString().slice(0, 10);
  const toIso = ok(u.searchParams.get('to')) ? u.searchParams.get('to') : fromIso;
  const from = dayStart(fromIso), to = dayStart(toIso);
  if (!(to > from) || to - from > 400 * 864e5) return json({ error: 'Zeitraum ungültig' }, 400);
  const b = await busy(from, to);
  return json({ ...b, events: b.events.map((e) => ({ ...e, start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString(), title: e.title.slice(0, 120) })) });
});
export const config = { path: '/api/calendar' };
