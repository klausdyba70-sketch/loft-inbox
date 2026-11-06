// Entwurf verfeinern (kürzer, freundlicher, Sie-Form …)
import { guard, json, requireOwner } from '../lib/core.mjs';
import { refineText } from '../lib/ai.mjs';
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  await requireOwner(req);
  const { text, instruction } = await req.json();
  if (!text?.trim()) return json({ error: 'Kein Text' }, 400);
  return json({ ok: true, text: await refineText(text, String(instruction || '').slice(0, 300)) });
});
export const config = { path: '/api/ai/refine' };
