// Antwortvorschlag schreiben. stream:true liefert den Text Wort für Wort und speichert am Ende.
import { guard, json, requireOwner } from '../lib/core.mjs';
import { draftVariant, draftPrompt, claudeStream, saveDraft, claude } from '../lib/ai.mjs';
export default guard(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST' }, 405);
  const { db } = await requireOwner(req);
  const { threadId, variant, stream, current, instruction } = await req.json();
  if (!stream) return json({ ok: true, draft: await draftVariant(db, threadId, variant) });
  const d = await draftPrompt(db, threadId, variant, { current: String(current || '').slice(0, 8000), instruction: String(instruction || '').slice(0, 400) });
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      let raw = '';
      try {
        for await (const chunk of claudeStream({ system: d.system, prompt: d.prompt })) { raw += chunk; ctrl.enqueue(enc.encode(chunk)); }
        await saveDraft(db, threadId, d, raw);
      } catch (e) {
        console.error(e);
        ctrl.enqueue(enc.encode('\n[[FEHLER: ' + (e.message || 'KI-Fehler') + ']]'));
      }
      ctrl.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-draft-position': String(d.position), 'x-draft-based-on': d.based_on } });
});
export const config = { path: '/api/ai/draft' };
