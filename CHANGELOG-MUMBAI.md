# Mumbai changelog

Work done during the ETHGlobal Mumbai window, for the 0G "Keep Building on 0G" continuity track.

**Starting commit:** not recorded in this repository. Its first commit (`71791f4`, 2026-11-06) already contains BonFire *and* the Study Pod. Add the hash of the pre-hackathon BonFire state here before submitting to the continuity track.

## 2026-11-06 — Study memory: RAG on 0G Private Computer (new 0G usage: embeddings)

- **New 0G usage.** `POST https://router-api.0g.ai/v1/embeddings` with `qwen3-embedding-0.6b`, traced like chat: every embedding call's request ID appears in the reply's `0G · …` badge and counts toward the per-student daily cap. Example request ID from the phase-0 check (`agent/scripts/smoke-embeddings.mjs`): `4b06f287-fcf2-40d2-ae18-544f9bbde215`.
- **Study memory per student.** Each photographed page is chunked, embedded on 0G and stored in the student's own index. The Tutor recalls related passages from earlier days and cites them (`[notes · <day> · #n]`), and the Examiner sometimes quizzes on them. A `📚 from your notes` chip shows on replies that cite past notes. (`add0bc6`, `3f32705`, `1872f0c`)
- **Knowledge-base retrieval.** Server knowledge docs are ranked by relevance (0G embeddings, via admin-only agent routes) instead of "newest 20 docs, 8 KB", with `[kb · <title> · #n]` citations and a fallback to the old behaviour. (`ee9b8e7`, `b9a25b3`)
- **Security.** `/chat/message` no longer trusts a caller-supplied `studentId`; only the backend (admin token) can name the student. Retrieved text is delimited as untrusted, with a rule against following instructions inside it. (`bbcf2db`)
- **Tests.** Unit, integration and live E2E coverage for RAG. The live run against the real 0G router passed: two different photos were remembered, `/study/recall` found the first one only for its owner, and the Tutor answered from the first photo with a citation and a `⟦0g:…⟧` marker.

## 2026-11-06 — Study Pod hardening and tooling

- Admin API gate (`AGENT_ADMIN_TOKEN`), MCP env masking, unforgeable 0G proof badge, lossless flashcard log (`825c792`, `4733b1a`).
- Security and Study Pod hardening test suites (`6a2e4da`); one-command local run, full test runner, live E2E against real 0G (`163fee6`).
