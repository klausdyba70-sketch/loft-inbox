// Antwortvorschlag im Hintergrund schreiben (bis 15 Minuten statt kurzer Zeitgrenze).
// Der Fortschritt landet laufend in sync_state unter "draft:<threadId>", die App liest ihn mit.
import { requireOwner } from '../lib/core.mjs';
import { draftPrompt, claudeStream, saveDraft, claude } from '../lib/ai.mjs';

export default async (req) => {
  let db, key, reqId;
  const put = (value) => db.from('sync_state').upsert({ key, value: { ...value, reqId, at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  try {
    ({ db } = await requireOwner(req));
    const { threadId, variant, current, instruction, reqId: rid } = await req.json();
    key = 'draft:' + threadId; reqId = String(rid || Date.now());
    await put({ status: 'running', text: '' });
    const d = await draftPrompt(db, threadId, variant, { current: String(current || '').slice(0, 8000), instruction: String(instruction || '').slice(0, 400) });
    const kind = instruction ? 'Ändern' : 'Antwort';
    const info = {};
    let raw = '', last = 0, pending = Promise.resolve();
    for await (const chunk of claudeStream({ system: d.system, prompt: d.prompt, info, kind })) {
      raw += chunk;
      if (Date.now() - last > 500) { last = Date.now(); await pending; pending = put({ status: 'running', text: raw }); }
    }
    await pending;
    if (!raw.trim()) {
      d.diag = 'leer, Ende ' + (info.stop || '?') + ', Modell ' + (info.model || '?');
      raw = await claude({ model: process.env.AI_MODEL_WRITE || 'claude-sonnet-5-5', system: d.system, prompt: d.prompt, max_tokens: 1500, timeoutMs: 60000, kind });
    }
    if (info.stop === 'max_tokens') console.error('Antwort bei max_tokens abgeschnitten');
    const saved = await saveDraft(db, threadId, d, raw);
    await put({ status: 'done', text: saved.body, label: saved.label, based_on: saved.based_on });
  } catch (e) {
    console.error(e);
    // Fehler nicht werfen, sonst wiederholt Netlify den Lauf
    if (db && key) await put({ status: 'error', error: e.message || 'KI-Fehler' }).catch(() => {});
  }
};
export const config = { path: '/api/ai/draft-run', background: true };
