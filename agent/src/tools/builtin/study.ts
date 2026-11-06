import { tool } from 'ai';
import { z } from 'zod';
import { DEFAULT_VISION_MODEL, routerBaseUrl, routerFetch } from '../../providers/zerog-router.js';
import { currentContext } from '../../runtime/request-context.js';
import { logStudySet, UPLOAD_ID } from '../../study/store.js';
import { readUpload } from '../../study/uploads.js';
import { indexNotes, recallNotes } from '../../rag/notes.js';
import { formatRetrievedBlock } from '../../rag/search.js';
import { log } from '../../util/logger.js';

/**
 * Study Pod tools: read a photo of notes with 0G vision (and index it into the student's study memory),
 * recall passages from the student's own past notes (RAG on 0G embeddings), log flashcards for the streak.
 */
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
        // Study memory: index for this student. A failure here never fails read_notes.
        const studentId = currentContext()?.studentId;
        let remembered = false;
        if (studentId) {
          try {
            remembered = (await indexNotes(agentDir, studentId, { uploadId, text: notes })).chunks > 0;
          } catch (e: any) {
            // Never log note text or vectors.
            log.warn({ err: e?.name, kind: e?.kind, status: e?.status }, 'study memory: indexing notes failed');
          }
        }
        return { ok: true, notes, remembered };
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
        const saved = await logStudySet(agentDir, studentId, { topic, cards });
        // Flashcards travel with the reply (attached by the runtime), so the Examiner always sees them.
        const ctx = currentContext();
        if (ctx) ctx.flashcards = cards.map(({ q, a }) => ({ q, a }));
        return { ok: true, ...saved };
      } catch (e: any) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
  });

  const recall_notes = tool({
    description:
      "Search this student's own earlier study notes (photos from before this message) for passages related to a query. Never returns the notes being studied right now. Returns passages with citations like [notes · 2026-11-05 · #2]. Only cite passages it returns; on no hits, say nothing about earlier notes.",
    parameters: z.object({
      query: z.string().min(1).max(500),
      k: z.number().int().min(1).max(8).optional(),
    }),
    execute: async ({ query, k }) => {
      const studentId = currentContext()?.studentId;
      if (!studentId) return { ok: false, error: 'no student identified for this turn; past notes are not available' };
      try {
        const excludeUploadIds = currentContext()?.excludeUploadIds;
        const { hits } = await recallNotes(agentDir, studentId, query, { k: k ?? 4, excludeUploadIds });
        if (hits.length === 0) return { ok: true, found: 0, note: 'no related earlier notes; continue normally and do not mention earlier notes' };
        return {
          ok: true,
          found: hits.length,
          citations: hits.map((h) => `[${h.citation}]`),
          passages: formatRetrievedBlock(hits, 'retrieved_notes'),
        };
      } catch (e: any) {
        log.warn({ err: e?.name, kind: e?.kind, status: e?.status }, 'study memory: recall failed');
        return { ok: false, error: "couldn't search past notes right now (0G embeddings unavailable); continue without them, don't cite any and don't mention it" };
      }
    },
  });

  return { read_notes, recall_notes, study_log };
}
