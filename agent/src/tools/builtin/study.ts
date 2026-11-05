import { tool } from 'ai';
import { z } from 'zod';
import { DEFAULT_VISION_MODEL, routerBaseUrl, routerFetch } from '../../providers/zerog-router.js';
import { currentContext } from '../../runtime/request-context.js';
import { logStudySet, UPLOAD_ID } from '../../study/store.js';
import { readUpload } from '../../study/uploads.js';


/** Study Pod tools: read a photo of notes with 0G vision; log flashcards for the per-user daily streak. */
export function makeStudyTools(agentDir: string) {
  const read_notes = tool({
    description:
      'Read a photo of handwritten/printed notes uploaded by the student (uploadId from the [[upload:ID]] marker in their message) using 0G Private Computer vision. Returns the extracted notes text.',
    parameters: z.object({ uploadId: z.string().regex(UPLOAD_ID) }),
    execute: async ({ uploadId }) => {
      const key = currentContext()?.zerogApiKey ?? process.env.ZEROG_API_KEY;
      if (!key) return { ok: false, error: "couldn't read the notes: ZEROG_API_KEY is not set" };
      const dataUrl = await readUpload(agentDir, uploadId);
      if (!dataUrl) return { ok: false, error: "couldn't read the notes: upload not found (it may have expired)" };
      try {
        const res = await routerFetch(`${routerBaseUrl()}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: process.env.ZEROG_VISION_MODEL ?? DEFAULT_VISION_MODEL,
            max_tokens: 1500,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'Transcribe these study notes faithfully as clean markdown (keep headings, formulas, lists). Then list the 3-6 key concepts. Do not add facts that are not in the image.' },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            }],
          }),
        });
        if (!res.ok) return { ok: false, status: res.status, error: "couldn't read the notes: the vision call failed" };
        const j: any = await res.json();
        const notes = j?.choices?.[0]?.message?.content;
        if (typeof notes !== 'string' || !notes.trim()) return { ok: false, error: "couldn't read the notes: empty vision response" };
        return { ok: true, notes };
      } catch (e: any) {
        return { ok: false, error: `couldn't read the notes: ${String(e?.message ?? e).slice(0, 120)}` };
      }
    },
  });

  const study_log = tool({
    description: "Save flashcards for today to the student's study log (counts toward their daily streak). Call once per study session.",
    parameters: z.object({
      topic: z.string().max(120),
      cards: z.array(z.object({ q: z.string(), a: z.string() })).min(1).max(20),
    }),
    execute: async ({ topic, cards }) => {
      const studentId = currentContext()?.studentId;
      if (!studentId) return { ok: false, error: 'no student identified for this turn; flashcards not saved' };
      try {
        return { ok: true, ...(await logStudySet(agentDir, studentId, { topic, cards })) };
      } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
  });

  return { read_notes, study_log };
}
