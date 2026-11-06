"use client";
import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Message text. Agent replies render as markdown; human messages stay plain text, so nobody can style
 * fake system text. Model output is untrusted: raw HTML stays escaped (no rehype-raw), links are limited
 * to http(s)/mailto, and images are never loaded (their alt text is shown). ⟦0g:…⟧ and [[upload:…]]
 * markers must be stripped before this (parseMarkers in study-markers.ts).
 */

/** The href to use, or null. Anything but http(s)/mailto, including relative links, is refused. */
export function safeHref(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "mailto:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Past this size a reply is shown as plain text, so the page never stalls whatever a model returns.
 * Measured: 78k chars 360 ms, 158k 970 ms, 318k 3.3 s. Real pod replies are a few thousand characters.
 */
export const MAX_MARKDOWN_CHARS = 60_000;

const heading = ({ children }: { children?: ReactNode }) => (
  <p className="font-semibold mt-2 mb-1 first:mt-0" style={{ color: "var(--foreground)" }}>{children}</p>
);

const COMPONENTS: Components = {
  a: ({ href, children }) => {
    const safe = safeHref(href);
    if (!safe) return <span>{children}</span>;
    return <a href={safe} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--bf-accent)" }}>{children}</a>;
  },
  img: ({ alt }) => <span style={{ color: "var(--bf-gray)" }}>{alt ? `[image: ${alt}]` : "[image]"}</span>,
  h1: heading, h2: heading, h3: heading, h4: heading, h5: heading, h6: heading,
  p: ({ children }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-1.5 last:mb-0 flex flex-col gap-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-1.5 last:mb-0 flex flex-col gap-0.5">{children}</ol>,
  blockquote: ({ children }) => (
    <blockquote className="pl-3 mb-1.5 border-l-2" style={{ borderColor: "var(--bf-border)", color: "var(--bf-gray)" }}>{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="rounded-md p-2.5 mb-1.5 overflow-x-auto text-xs font-mono" style={{ background: "var(--bf-quaternary)", color: "var(--foreground)" }}>{children}</pre>
  ),
  code: ({ className, children }) => (
    <code className={`font-mono ${className ?? ""}`} style={{ background: "var(--bf-quaternary)", color: "var(--foreground)", borderRadius: 3, padding: "0 3px" }}>{children}</code>
  ),
  table: ({ children }) => <div className="overflow-x-auto mb-1.5"><table className="text-xs border-collapse [overflow-wrap:normal]">{children}</table></div>,
  th: ({ children }) => <th className="border px-2 py-1 text-left font-semibold" style={{ borderColor: "var(--bf-border)" }}>{children}</th>,
  td: ({ children }) => <td className="border px-2 py-1" style={{ borderColor: "var(--bf-border)" }}>{children}</td>,
};

// singleTilde off: in study notes "~3 ATP and ~5 NADPH" means "about", not strikethrough.
const REMARK_PLUGINS: NonNullable<Parameters<typeof ReactMarkdown>[0]["remarkPlugins"]> = [[remarkGfm, { singleTilde: false }]];

function MessageBody({ content, isBot }: { content: string; isBot?: boolean }) {
  const plain = !isBot || content.length > MAX_MARKDOWN_CHARS;
  if (plain) {
    return <p className="text-sm leading-relaxed mt-0.5 [overflow-wrap:anywhere]" style={{ color: "var(--foreground)" }}>{content}</p>;
  }
  return (
    <div className="text-sm leading-relaxed mt-0.5 [overflow-wrap:anywhere] min-w-0" style={{ color: "var(--foreground)" }}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} urlTransform={(u) => u}>{content}</ReactMarkdown>
    </div>
  );
}

// A channel re-renders often (polling, status); parsing a reply again each time would add up.
export default memo(MessageBody);
