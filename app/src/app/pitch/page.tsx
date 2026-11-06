"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Slides sit on a black ground, so use DESIGN.md's light tints (mint, butter) — the ink/mint-ink
// values are for the bone ground and disappear here.
const ACCENT = "#c7e6da";
const BANANA = "#f6dcab";

const SLIDES = [
  { id: "title", label: "00 — 0G Study" },
  { id: "problem", label: "01 — The Problem" },
  { id: "solution", label: "02 — Study Pod" },
  { id: "architecture", label: "03 — How It Works" },
  { id: "demo", label: "04 — Live Demo" },
  { id: "stack", label: "05 — Sponsor Stack" },
  { id: "why-now", label: "06 — Why Now" },
];

export default function PitchPage() {
  const [current, setCurrent] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  const isScrolling = useRef(false);

  const goTo = (i: number) => {
    const next = Math.max(0, Math.min(SLIDES.length - 1, i));
    const el = slideRefs.current[next];
    if (!el) return;
    isScrolling.current = true;
    setCurrent(next);
    el.scrollIntoView({ behavior: "smooth" });
    window.setTimeout(() => (isScrolling.current = false), 700);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (["ArrowRight", "ArrowDown", " "].includes(e.key)) {
        e.preventDefault();
        goTo(current + 1);
      } else if (["ArrowLeft", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        goTo(current - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrolling.current) return;
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
            const idx = slideRefs.current.indexOf(entry.target as HTMLElement);
            if (idx !== -1) setCurrent(idx);
          }
        });
      },
      { root, threshold: [0.55, 0.75] }
    );
    slideRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-[var(--on-ink)]">
      <Link
        href="/"
        className="fixed left-8 top-6 z-50 flex items-center gap-2 text-sm font-semibold tracking-tight text-[var(--on-ink-muted)] transition hover:text-[var(--on-ink)]"
      >
        <span style={{ color: ACCENT }} aria-hidden>
          🔥
        </span>
        0G Study
      </Link>

      {/* Slide indicator dots */}
      <div className="pointer-events-none fixed right-8 top-1/2 z-50 -translate-y-1/2">
        <div className="flex flex-col items-center gap-3">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              onClick={() => goTo(i)}
              className="pointer-events-auto rounded-full transition-all"
              style={{
                width: 6,
                height: i === current ? 26 : 6,
                background: i === current ? ACCENT : "rgba(255,255,255,0.25)",
              }}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Arrows */}
      {current > 0 && (
        <button
          onClick={() => goTo(current - 1)}
          className="fixed left-8 top-1/2 z-50 -translate-y-1/2 rounded-full border border-[var(--bf-border)] bg-white/[0.03] p-3 text-[var(--muted)] transition hover:border-[var(--bf-border)] hover:text-[var(--foreground)]"
          aria-label="Previous"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
      {current < SLIDES.length - 1 && (
        <button
          onClick={() => goTo(current + 1)}
          className="fixed right-20 top-1/2 z-50 -translate-y-1/2 rounded-full border border-[var(--bf-border)] bg-white/[0.03] p-3 text-[var(--muted)] transition hover:border-[var(--bf-border)] hover:text-[var(--foreground)]"
          aria-label="Next"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {/* Counter */}
      <div className="pointer-events-none fixed bottom-6 right-8 z-50 font-mono text-xs tracking-widest text-[var(--subtle)]">
        {String(current + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
      </div>

      {/* Keyboard hint */}
      <div className="pointer-events-none fixed bottom-6 left-8 z-50 font-mono text-xs tracking-widest text-[var(--subtle)]">
        ← → to navigate
      </div>

      {/* Scroll container */}
      <div
        ref={containerRef}
        className="h-screen w-screen snap-y snap-mandatory overflow-y-auto"
        style={{ scrollBehavior: "smooth" }}
      >
        {/* Slide 1 — Title */}
        <section
          ref={(el) => {
            slideRefs.current[0] = el;
          }}
          className="relative flex h-screen w-screen snap-start items-center justify-center overflow-hidden"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(129,22,224,0.25) 0%, rgba(0,0,0,1) 65%)",
          }}
        >
          <div className="relative z-10 mx-auto flex max-w-[1200px] flex-col items-center px-20 text-center">
            {/* Flame animation (PIXI/GSAP) — served from /public/flame.html */}
            <div className="pointer-events-none relative mb-2 h-[260px] w-[360px]">
            </div>
            <h1 className="font-display text-7xl md:text-8xl tracking-tight" style={{ fontWeight: 400 }}>
              0G Study
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg text-[var(--muted)]">
              <span style={{ color: ACCENT }} className="font-semibold">
                Study Pod
              </span>
              : a photo of your notes in; an explanation, flashcards and a quiz out. Powered by 0G Private Computer.
            </p>
            <div className="mt-10 flex justify-center gap-3">
              {["0G Private Computer", "Request IDs", "ERC-7857 INFTs", "Study streak"].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-[var(--bf-border)] bg-[rgba(19,19,21,0.05)] px-4 py-1.5 font-mono text-xs tracking-wider text-[var(--muted)]"
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 animate-bounce text-[var(--subtle)]">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>
        </section>

        {/* Slide 2 — Problem */}
        <section
          ref={(el) => {
            slideRefs.current[1] = el;
          }}
          className="flex h-screen w-screen snap-start items-center justify-center"
        >
          <div className="mx-auto max-w-[1200px] px-20">
            <div
              className="mb-4 font-mono text-sm uppercase tracking-widest"
              style={{ color: ACCENT }}
            >
              01 — The Problem
            </div>
            <h2 className="font-display text-5xl md:text-6xl leading-tight" style={{ fontWeight: 400 }}>
              Notes pile up.
              <br />
              Studying <span style={{ color: BANANA }}>doesn&apos;t happen</span>.
            </h2>
            <p className="mt-8 max-w-3xl text-base text-[var(--muted)]">
              Students re-read, or paste notes into a chatbot that never quizzes them, never tracks
              them, and never says where the answer came from.
            </p>

            <div className="mt-12 grid grid-cols-3 gap-6">
              {[
                {
                  title: "Re-reading",
                  desc: "Feels like work, but re-reading notes is not studying.",
                },
                {
                  title: "One chatbot",
                  desc: "Answers questions, but never quizzes you, tracks you, or brings you back.",
                },
                {
                  title: "No provenance",
                  desc: "You cannot tell which model answered, or check it later.",
                },
              ].map((p) => (
                <div
                  key={p.title}
                  className="rounded-2xl border border-[var(--bf-border)] bg-white/[0.02] p-8"
                >
                  <div
                    className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{ background: `${ACCENT}15` }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </div>
                  <div className="text-lg font-semibold text-[var(--foreground)]">{p.title}</div>
                  <div className="mt-2 text-sm text-[var(--subtle)]">{p.desc}</div>
                </div>
              ))}
            </div>

            <p className="mt-10 font-mono text-sm italic text-[var(--subtle)]">
              Studying needs someone to explain, someone to test you, and a reason to come back tomorrow.
            </p>
          </div>
        </section>

        {/* Slide 3 — Solution */}
        <section
          ref={(el) => {
            slideRefs.current[2] = el;
          }}
          className="flex h-screen w-screen snap-start items-center justify-center"
        >
          <div className="mx-auto max-w-[1200px] px-20">
            <div
              className="mb-4 font-mono text-sm uppercase tracking-widest"
              style={{ color: ACCENT }}
            >
              02 — Study Pod
            </div>
            <h2 className="font-display text-5xl md:text-6xl leading-tight" style={{ fontWeight: 400 }}>
              A study pod for{" "}
              <span style={{ color: ACCENT }}>your notes</span>.
            </h2>
            <p className="mt-6 max-w-3xl text-base text-[var(--muted)]">
              Three agents read, teach and test in one channel. Every hand-off is visible.
              Every reply carries the 0G request ID that produced it.
            </p>

            <div
              className="mt-8 rounded-2xl border p-6"
              style={{ borderColor: `${ACCENT}33`, background: `${ACCENT}08` }}
            >
              <p className="font-display text-2xl leading-snug">
                &ldquo;Photograph your notes. @study-note-reader reads them, @study-tutor explains and writes flashcards, @study-examiner quizzes you.&rdquo;
              </p>
            </div>

            <div className="mt-10 grid grid-cols-4 gap-5">
              {[
                { stat: "3", label: "Agents in the pod", sub: "Reader → Tutor → Examiner" },
                { stat: "6", label: "Flashcards per session", sub: "Logged to your study log" },
                { stat: "1", label: "Request ID per 0G call", sub: "Shown on every reply" },
                { stat: "🔥", label: "Daily streak", sub: "Per user, in the status bar" },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-2xl border border-[var(--bf-border)] bg-white/[0.02] p-6"
                >
                  <div
                    className="font-display text-5xl"
                    style={{ color: ACCENT }}
                  >
                    {s.stat}
                  </div>
                  <div className="mt-3 text-sm font-semibold text-[var(--foreground)]">
                    {s.label}
                  </div>
                  <div className="mt-1 text-xs text-[var(--subtle)]">{s.sub}</div>
                </div>
              ))}
            </div>

            <p className="mt-8 text-sm text-[var(--subtle)]">
              Runs inside 0G Study: Discord-style servers, channels and @mentions, with agents
              owned as INFTs on 0G Chain.
            </p>
          </div>
        </section>

        {/* Slide 4 — Architecture / How it works */}
        <section
          ref={(el) => {
            slideRefs.current[3] = el;
          }}
          className="flex h-screen w-screen snap-start items-center justify-center"
        >
          <div className="mx-auto max-w-[1200px] px-20">
            <div
              className="mb-4 font-mono text-sm uppercase tracking-widest"
              style={{ color: ACCENT }}
            >
              03 — How It Works
            </div>
            <h2 className="font-display text-5xl md:text-6xl leading-tight" style={{ fontWeight: 400 }}>
              Every agent reply runs on <span style={{ color: ACCENT }}>0G Private Computer</span>.
            </h2>
            <p className="mt-6 max-w-3xl text-base text-[var(--muted)]">
              Chat and vision inference go through 0G&apos;s OpenAI-compatible router. Each call returns a
              request ID, and the pod shows it on the reply.
            </p>

            <div className="mt-10 grid grid-cols-2 gap-5">
              <div
                className="rounded-2xl border p-7"
                style={{ borderColor: `${ACCENT}33`, background: `${ACCENT}08` }}
              >
                <div className="font-mono text-xs tracking-widest" style={{ color: ACCENT }}>
                  ERC-7857 · 0G CHAIN
                </div>
                <div className="mt-2 text-xl font-semibold text-[var(--foreground)]">Agents as INFTs</div>
                <div className="mt-2 text-sm text-[var(--subtle)]">
                  Marketplace agents are minted on the Galileo testnet with encrypted metadata on 0G Storage.
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["mint", "usage authorization", "encrypted-metadata", "Galileo 16602"].map((t) => (
                    <span key={t} className="rounded-full border border-[var(--bf-border)] bg-[rgba(19,19,21,0.05)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted)]">
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--bf-border)] bg-white/[0.02] p-7">
                <div className="font-mono text-xs tracking-widest" style={{ color: BANANA }}>
                  0G PRIVATE COMPUTER
                </div>
                <div className="mt-2 text-xl font-semibold text-[var(--foreground)]">Private Computer</div>
                <div className="mt-2 text-sm text-[var(--subtle)]">
                  Inference through an OpenAI-compatible router on compute 0G describes as TEE-verified, with a copyable request ID on every reply.
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["chat", "vision", "request ID", "OpenAI-compat"].map((t) => (
                    <span key={t} className="rounded-full border border-[var(--bf-border)] bg-[rgba(19,19,21,0.05)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted)]">
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--bf-border)] bg-white/[0.02] p-7">
                <div className="font-mono text-xs tracking-widest" style={{ color: BANANA }}>
                  0G STORAGE
                </div>
                <div className="mt-2 text-xl font-semibold text-[var(--foreground)]">Agent Bundles</div>
                <div className="mt-2 text-sm text-[var(--subtle)]">
                  Encrypted soul, rules and model config for marketplace agents, decrypted only to run them.
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["AES-256-GCM", "sealed keys", "manifest", "bundle"].map((t) => (
                    <span key={t} className="rounded-full border border-[var(--bf-border)] bg-[rgba(19,19,21,0.05)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted)]">
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--bf-border)] bg-white/[0.02] p-7">
                <div className="font-mono text-xs tracking-widest" style={{ color: BANANA }}>
                  PRIVY
                </div>
                <div className="mt-2 text-xl font-semibold text-[var(--foreground)]">Sign-in + Wallet</div>
                <div className="mt-2 text-sm text-[var(--subtle)]">
                  Email or Google login with an embedded wallet. No seed phrase.
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["email", "google", "embedded wallet", "no seed phrase"].map((t) => (
                    <span key={t} className="rounded-full border border-[var(--bf-border)] bg-[rgba(19,19,21,0.05)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted)]">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Animated flow: dot travels along the pipeline */}
            <div className="mt-8 overflow-hidden rounded-xl border border-[var(--bf-border)] bg-white/[0.02] p-5">
              <div className="flex items-center justify-between gap-3 font-mono text-[11px] tracking-wider text-[var(--muted)]">
                {["NOTES PHOTO", "#STUDY", "NOTE READER", "TUTOR", "EXAMINER", "REPLY + 0G ID"].map((label, i, arr) => (
                  <span
                    key={label}
                    style={{ color: i === arr.length - 1 ? BANANA : undefined }}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="relative mt-3 h-[3px] w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="absolute inset-y-0 w-full"
                  style={{
                    background: `linear-gradient(90deg, transparent 0%, ${ACCENT} 40%, ${BANANA} 60%, transparent 100%)`,
                    animation: "bfFlow 3.2s linear infinite",
                  }}
                />
              </div>
            </div>
            <style>{`@keyframes bfFlow { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }`}</style>
          </div>
        </section>

        {/* Slide 5 — Live Demo */}
        <section
          ref={(el) => {
            slideRefs.current[4] = el;
          }}
          className="flex h-screen w-screen snap-start items-center justify-center"
        >
          <div className="mx-auto max-w-[1200px] px-20">
            <div className="mb-4 flex items-center gap-3">
              <span
                className="font-mono text-sm uppercase tracking-widest"
                style={{ color: ACCENT }}
              >
                04 — Live Demo
              </span>
              <span className="flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-[10px] tracking-wider"
                style={{ borderColor: `${BANANA}44`, color: BANANA, background: `${BANANA}08` }}
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: BANANA }} />
                  <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: BANANA }} />
                </span>
                0G PRIVATE COMPUTER
              </span>
            </div>
            <h2 className="font-display text-5xl md:text-6xl leading-tight" style={{ fontWeight: 400 }}>
              From a photo of notes <span style={{ color: ACCENT }}>to a quiz</span>.
            </h2>
            <p className="mt-6 max-w-3xl text-base text-[var(--muted)]">
              The flow we run in the demo. Every agent reply shows its 0G request ID.
            </p>

            {/* Animated terminal-style mock */}
            <div className="mt-8 overflow-hidden rounded-xl border border-white/10 bg-black/60 font-mono text-[12px]">
              <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3a3a3a" }} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#3a3a3a" }} />
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: ACCENT }} />
                <span className="ml-3 text-[10px] tracking-widest text-[var(--subtle)]">0g study · #study</span>
              </div>
              <div className="space-y-1 px-5 py-4">
                <div className="text-[var(--foreground)]"><span style={{ color: ACCENT }}>@you</span> 📎 notes photo · @study-note-reader</div>
                <div className="text-[var(--muted)]"><span style={{ color: BANANA }}>@study-note-reader</span> reading your notes<span className="bf-dots" /></div>
                <div className="text-[var(--muted)]"><span style={{ color: BANANA }}>@study-tutor</span> 3 hard ideas explained · 6 flashcards logged · 0G · request ID</div>
                <div className="text-[var(--muted)]"><span style={{ color: BANANA }}>@study-examiner</span> Question 1: why does …? · 0G · request ID</div>
                <div className="text-[var(--subtle)]">▮</div>
              </div>
              <style>{`.bf-dots::after { content: "..."; display:inline-block; animation: bfDots 1.4s steps(4,end) infinite; width: 1.2em; text-align:left; } @keyframes bfDots { 0%{content:""} 25%{content:"."} 50%{content:".."} 75%,100%{content:"..."} }`}</style>
            </div>

            <div className="mt-8 grid grid-cols-4 gap-5">
              {[
                { n: "01", t: "Attach notes", d: "Press + in #study, pick a photo, mention @study-note-reader." },
                { n: "02", t: "Note Reader", d: "0G vision transcribes the photo and lists the key concepts." },
                { n: "03", t: "Tutor", d: "Explains the hardest ideas, writes 6 flashcards, extends your streak." },
                { n: "04", t: "Examiner", d: "Asks one question at a time and grades each answer." },
              ].map((s) => (
                <div
                  key={s.n}
                  className="rounded-2xl border border-[var(--bf-border)] bg-white/[0.02] p-6 transition-colors hover:border-[var(--bf-border)]"
                >
                  <div className="font-mono text-xs tracking-widest" style={{ color: ACCENT }}>{s.n}</div>
                  <div className="mt-3 text-base font-semibold text-[var(--foreground)]">{s.t}</div>
                  <div className="mt-2 text-sm text-[var(--subtle)]">{s.d}</div>
                </div>
              ))}
            </div>

            <div className="mt-10">
              <div className="font-mono text-xs uppercase tracking-widest text-[var(--subtle)]">
                What this proves
              </div>
              <div className="mt-4 grid grid-cols-4 gap-4">
                {[
                  "0G request ID on every reply",
                  "Vision + chat on Private Computer",
                  "Per-day study streak",
                  "INFT agents on 0G Galileo",
                ].map((p) => (
                  <div key={p} className="flex items-center gap-2 text-sm text-[var(--muted)]">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BANANA} strokeWidth="2.5">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                    {p}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Slide 6 — Sponsor stack / Track alignment */}
        <section
          ref={(el) => {
            slideRefs.current[5] = el;
          }}
          className="flex h-screen w-screen snap-start items-center justify-center"
        >
          <div className="mx-auto max-w-[1200px] px-20">
            <div
              className="mb-4 font-mono text-sm uppercase tracking-widest"
              style={{ color: ACCENT }}
            >
              05 — Sponsor Stack
            </div>
            <h2 className="font-display text-5xl md:text-6xl leading-tight" style={{ fontWeight: 400 }}>
              What each piece <span style={{ color: ACCENT }}>does</span>.
            </h2>
            <p className="mt-6 max-w-3xl text-base text-[var(--muted)]">
              0G Private Computer is on the critical path of every pod reply. The rest support the wider workspace.
            </p>

            <div className="mt-10 overflow-hidden rounded-2xl border border-[var(--bf-border)]">
              <div className="grid grid-cols-12 border-b border-[var(--bf-border)] bg-white/[0.02] px-6 py-3 font-mono text-[11px] uppercase tracking-widest text-[var(--subtle)]">
                <div className="col-span-3">Sponsor</div>
                <div className="col-span-4">What it powers</div>
                <div className="col-span-3">Track fit</div>
                <div className="col-span-2 text-right">Critical?</div>
              </div>
              {[
                { s: "0G Private Computer", w: "Chat + vision inference, request ID per call", t: "Private AI", c: true },
                { s: "0G Chain", w: "INFT registry on the Galileo testnet", t: "AI Infra", c: true },
                { s: "0G Storage", w: "Encrypted marketplace agent bundles", t: "Storage", c: true },
                { s: "ERC-7857", w: "Agents as ownable INFTs", t: "Token Standards", c: true },
                { s: "Privy", w: "Sign-in + embedded wallet", t: "Consumer UX", c: true },
                { s: "Daily.co", w: "Voice channels (not used by Study Pod)", t: "Real-time AI", c: false },
              ].map((row) => (
                <div
                  key={row.s}
                  className="grid grid-cols-12 items-center border-b border-[var(--bf-border)] px-6 py-4 last:border-0 transition-colors hover:bg-white/[0.02]"
                >
                  <div className="col-span-3 font-semibold text-[var(--foreground)]">{row.s}</div>
                  <div className="col-span-4 text-sm text-[var(--muted)]">{row.w}</div>
                  <div className="col-span-3">
                    <span className="rounded-full border border-[var(--bf-border)] bg-[rgba(19,19,21,0.05)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted)]">
                      {row.t}
                    </span>
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {row.c ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={BANANA} strokeWidth="2.5" aria-label="yes">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    ) : (
                      <span className="font-mono text-[11px] tracking-wider text-[var(--subtle)]">optional</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-8 font-mono text-xs tracking-wider text-[var(--subtle)]">
              Remove 0G Private Computer and the pod does nothing: the Note Reader can&apos;t read the photo, and the Tutor and Examiner have no inference.
            </p>
          </div>
        </section>

        {/* Slide 7 — Why now / Closing */}
        <section
          ref={(el) => {
            slideRefs.current[6] = el;
          }}
          className="flex h-screen w-screen snap-start items-center justify-center"
        >
          <div className="mx-auto max-w-[1200px] px-20">
            <div
              className="mb-4 font-mono text-sm uppercase tracking-widest"
              style={{ color: ACCENT }}
            >
              06 — Why Now
            </div>
            <h2 className="font-display text-5xl md:text-6xl leading-tight" style={{ fontWeight: 400 }}>
              The primitives just landed.
            </h2>

            <div className="mt-12 grid grid-cols-2 gap-6">
              {[
                {
                  n: "01",
                  title: "0G Private Computer",
                  detail: "One OpenAI-compatible API for chat and vision; 0G describes it as TEE-verified compute.",
                  hl: "Request ID on every call",
                },
                {
                  n: "02",
                  title: "ERC-7857-style INFTs",
                  detail: "An ERC-721 with ERC-7857-style encrypted metadata, for ownable agents.",
                  hl: "Encrypted, ownable agents",
                },
                {
                  n: "03",
                  title: "Multimodal models",
                  detail: "Vision models can read a photo of your notes.",
                  hl: "Photo in, flashcards out",
                },
                {
                  n: "04",
                  title: "Privy",
                  detail: "Wallet sign-in that feels like a normal email login.",
                  hl: "No seed phrase",
                },
              ].map((c) => (
                <div
                  key={c.n}
                  className="rounded-2xl border border-[var(--bf-border)] bg-white/[0.02] p-6 transition-colors hover:border-[var(--bf-border)]"
                >
                  <div
                    className="font-mono text-xs tracking-widest"
                    style={{ color: ACCENT }}
                  >
                    {c.n}
                  </div>
                  <div className="mt-2 text-xl font-semibold text-[var(--foreground)]">
                    {c.title}
                  </div>
                  <div className="mt-2 text-sm text-[var(--subtle)]">{c.detail}</div>
                  <div
                    className="mt-4 inline-block rounded-full border px-3 py-1 font-mono text-xs"
                    style={{
                      borderColor: `${BANANA}33`,
                      color: BANANA,
                      background: `${BANANA}08`,
                    }}
                  >
                    {c.hl}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-10 text-center font-mono text-sm tracking-wider text-[var(--subtle)]">
              Study something today. Come back tomorrow to keep the streak.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
