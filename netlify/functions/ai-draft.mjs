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
        const info = {};
        for await (const chunk of claudeStream({ system: d.system, prompt: d.prompt, info, kind: instruction ? 'Ändern' : 'Antwort' })) { raw += chunk; ctrl.enqueue(enc.encode(chunk)); }
        if (!raw.trim()) { // Stream kam leer: Grund merken und ohne Streaming nochmal versuchen
          d.diag = 'Stream leer, Ende ' + (info.stop || '?') + ', Modell ' + (info.model || '?') + ', Ausgabe ' + (info.usage?.output_tokens ?? '?') + ', ' + [...(info.types || [])].slice(0, 8).join(' ');
          console.error(d.diag);
          try { raw = await claude({ model: process.env.AI_MODEL_WRITE || 'claude-haiku-5-5', system: d.system, prompt: d.prompt, max_tokens: 1500, timeoutMs: 20000, kind: instruction ? 'Ändern' : 'Antwort' }); }
          catch (e2) { throw new Error(d.diag + ' | ' + e2.message); }
          ctrl.enqueue(enc.encode(raw));
        }
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
