import Link from "next/link";

// Copy follows prd.md §7 FR8. Visual grammar follows /DESIGN.md ("World Mod"):
// bone ground, stacked lozenges (30 / 22 / 16 / pill), one colour per meaning, no accent colour.

const WHAT_BREAKS =
  "Remove 0G and the pod stops: the Note Reader can't read the photo, and the Tutor and Examiner have no inference.";

const trust = ["0G request ID on every reply", "Daily study streak", "ERC-7857-style INFT agents"];

const problems = [
  "Re-reading your notes is not studying.",
  "A single chatbot answers questions, but it does not quiz you, track you, or bring you back.",
  "You cannot tell which model answered.",
];

const steps = [
  { n: "1", title: "Sign in", desc: "Privy gives you an embedded wallet. No seed phrase." },
  { n: "2", title: "Open #study", desc: "The three agents are already invited." },
  { n: "3", title: "Attach a photo of your notes", desc: "Press + in the composer and send." },
  { n: "4", title: "Learn and get quizzed", desc: "Come back tomorrow to keep the streak." },
];

const features = [
  { title: "Photo → notes", desc: "A 0G vision model transcribes printed or neat handwritten pages into clean notes." },
  { title: "A pod of three agents", desc: "A Note Reader, a Tutor and an Examiner hand off in one channel, and every hand-off is visible." },
  { title: "Flashcards that stick", desc: "The Tutor writes six cards that test understanding, not wording, and logs them." },
  { title: "Daily streak", desc: "Study a little each day. Your streak and card count live in the status bar." },
  { title: "Proof on every reply", desc: "Each reply carries the 0G request ID that produced it. Copy it and match it in the 0G dashboard." },
  { title: "Own your agents", desc: "Agents can be minted as ERC-7857-style INFTs on 0G Chain. Mint your own, or pick new ones from the marketplace." },
];

const stack = [
  { name: "Private Computer", desc: "Chat and vision inference through an OpenAI-compatible router, with a request ID per call." },
  { name: "0G Chain", desc: "ERC-7857-style INFT agents on the Galileo testnet." },
  { name: "0G Storage", desc: "Encrypted agent metadata and skills for marketplace agents." },
];

/** The signature Knob Bar: ink pill, mint knob inset at its head. */
function KnobBar({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="interactive relative flex h-16 w-full items-center justify-center rounded-full p-1.5 font-semibold"
      style={{ background: "var(--ink)", color: "var(--on-ink)" }}
    >
      <span
        aria-hidden
        className="absolute left-1.5 top-1.5 flex h-[52px] w-[52px] items-center justify-center rounded-full"
        style={{ background: "var(--mint)", color: "var(--mint-ink)" }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
      <span className="pl-[52px]">{children}</span>
    </Link>
  );
}

function PaperPill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="interactive lift flex w-full items-center justify-center rounded-full px-5 py-3 font-semibold"
      style={{ background: "var(--paper)", color: "var(--foreground)" }}
    >
      {children}
    </Link>
  );
}

export default function LandingPage() {
  return (
    <main className="fixed inset-0 overflow-y-auto" style={{ background: "var(--bone)", color: "var(--foreground)" }}>
      <div className="mx-auto w-full max-w-md px-4 pb-16">
        {/* Header */}
        <header className="flex items-center justify-between py-5">
          <Link href="/" className="text-[19px] font-semibold whitespace-nowrap" style={{ letterSpacing: "-0.025em" }}>
            0G Study
          </Link>
          <nav className="flex items-center gap-1 text-[13px] whitespace-nowrap" style={{ color: "var(--muted)" }}>
            <a href="#how" className="interactive rounded-full px-3 py-2 max-[419px]:hidden">How it works</a>
            <a href="#stack" className="interactive rounded-full px-3 py-2">Built on 0G</a>
            <Link href="/marketplace" className="interactive rounded-full px-3 py-2">Marketplace</Link>
          </nav>
        </header>

        {/* Hero */}
        <section className="settle mt-6">
          <span
            className="inline-block rounded-full px-4 py-2.5 text-[13px] font-semibold"
            style={{ background: "var(--lilac)", color: "var(--lilac-ink)" }}
          >
            Built on 0G Private Computer
          </span>
          <h1 className="mt-5 text-[38px] font-semibold" style={{ lineHeight: 1.05, letterSpacing: "-0.03em" }}>
            Your notes, studied by a pod of AI agents.
          </h1>
          <p className="mt-4 text-[15px]" style={{ color: "var(--muted)" }}>
            Photograph your notes. A Note Reader, a Tutor and an Examiner turn them into an explanation, flashcards and a
            quiz, powered by 0G Private Computer.
          </p>
          <p className="tag mt-3 text-[12px]">
            Come back tomorrow to keep your streak. Every reply shows the 0G request ID that produced it.
          </p>
          <div className="mt-7 space-y-3">
            <KnobBar href="/workspace">Start studying →</KnobBar>
            <PaperPill href="/marketplace">Browse the Marketplace</PaperPill>
          </div>
          <ul className="mt-6 flex flex-wrap gap-2">
            {trust.map((t) => (
              <li
                key={t}
                className="rounded-full px-4 py-2.5 text-[12px] font-medium"
                style={{ background: "var(--paper)", color: "var(--muted)" }}
              >
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* Why it matters */}
        <section className="mt-12">
          <h2 className="text-[19px] font-semibold" style={{ letterSpacing: "-0.025em" }}>Why it matters</h2>
          <div className="lift mt-3 space-y-3 rounded-[30px] px-5 py-7" style={{ background: "var(--paper)" }}>
            {problems.map((p) => (
              <p key={p} className="text-[15px]" style={{ color: "var(--foreground)" }}>{p}</p>
            ))}
          </div>
        </section>

        {/* Promise: mint = the task */}
        <section className="mt-3">
          <div className="rounded-[30px] px-5 py-7" style={{ background: "var(--mint)", color: "var(--mint-ink)" }}>
            <p className="text-[12px] font-medium">Study Pod</p>
            <h2 className="mt-1 text-[34px] font-semibold" style={{ lineHeight: 0.98, letterSpacing: "-0.035em" }}>
              A study group that never sleeps.
            </h2>
            <p className="mt-4 text-[14px]">
              It runs inside 0G Study, and every hand-off is visible. Inference goes through 0G Private Computer (embeddings on a TEE-private provider), and minted agents&apos;
              ownership lives on 0G Chain.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mt-12">
          <h2 className="text-[19px] font-semibold" style={{ letterSpacing: "-0.025em" }}>How it works</h2>
          <ol className="mt-3 space-y-3">
            {steps.map((s) => (
              <li key={s.n} className="lift flex items-start gap-4 rounded-[22px] px-4 py-3.5" style={{ background: "var(--paper)" }}>
                <span className="figure text-[34px]" style={{ color: "var(--lilac-ink)" }}>{s.n}</span>
                <div>
                  <p className="font-semibold">{s.title}</p>
                  <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted)" }}>{s.desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Features */}
        <section id="features" className="mt-12">
          <h2 className="text-[19px] font-semibold" style={{ letterSpacing: "-0.025em" }}>What you get</h2>
          <div className="mt-3 space-y-3">
            {features.map((f) => (
              <div key={f.title} className="lift rounded-[22px] px-4 py-3.5" style={{ background: "var(--paper)" }}>
                <p className="font-semibold">{f.title}</p>
                <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted)" }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Built on 0G: lilac = the machine's reading */}
        <section id="stack" className="mt-12">
          <h2 className="text-[19px] font-semibold" style={{ letterSpacing: "-0.025em" }}>Every step of the pod runs on 0G.</h2>
          <div className="mt-3 rounded-[30px] px-5 py-7" style={{ background: "var(--lilac)", color: "var(--lilac-ink)" }}>
            <p className="text-[15px] font-semibold">{WHAT_BREAKS}</p>
          </div>
          <div className="mt-3 space-y-3">
            {stack.map((r) => (
              <div key={r.name} className="lift rounded-[22px] px-4 py-3.5" style={{ background: "var(--paper)" }}>
                <p className="font-semibold">{r.name}</p>
                <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted)" }}>{r.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Final CTA */}
        <section className="mt-12">
          <div className="rounded-[30px] px-5 py-7" style={{ background: "var(--mint)", color: "var(--mint-ink)" }}>
            <h2 className="text-[34px] font-semibold" style={{ lineHeight: 0.98, letterSpacing: "-0.035em" }}>
              Study something today.
            </h2>
            <p className="mt-3 text-[14px]">
              Get an explanation, flashcards and a quiz in a couple of minutes.
            </p>
            <div className="mt-6">
              <KnobBar href="/workspace">Start studying</KnobBar>
            </div>
          </div>
        </section>

        <footer className="mt-10 text-center text-[12px]" style={{ color: "var(--subtle)" }}>
          <p>0G Study — built on 0G Private Computer.</p>
          <p className="mt-2 flex justify-center gap-4">
            <Link href="/workspace">Workspace</Link>
            <Link href="/marketplace">Marketplace</Link>
            <Link href="/pitch">Pitch</Link>
            <Link href="/login">Sign in</Link>
          </p>
        </footer>
      </div>
    </main>
  );
}
