import { parseMarkers } from "./study-markers";

/**
 * Rules for in-app agent notifications. Pure, so they're unit-tested apart from React.
 *
 * Product intent: a toast tells you about something you can't already see. A reply landing in the
 * channel you're reading is already on screen, so it must not also cover the conversation.
 */

/** How long a toast stays on screen (paused while hovered). */
export const TOAST_TTL_MS = 5000;
/** Never stack more than this many toasts; the newest win. */
export const MAX_VISIBLE_TOASTS = 2;
/** Preview length in characters (the rest is cut on a word boundary). */
export const TOAST_PREVIEW_CHARS = 90;

export type NotifyDecision = "none" | "toast" | "system";

/**
 * - Tab hidden → a system notification (if the user allowed them), never an in-app toast.
 * - Tab visible and the reply is in the channel on screen → nothing.
 * - Tab visible, reply elsewhere (or channel unknown) → in-app toast.
 */
export function notifyDecision(input: {
  replyChannelId: string | null | undefined;
  viewingChannelId: string | null | undefined;
  documentHidden: boolean;
  systemPermission: NotificationPermission | "unsupported";
}): NotifyDecision {
  if (input.documentHidden) return input.systemPermission === "granted" ? "system" : "none";
  if (input.replyChannelId && input.viewingChannelId && input.replyChannelId === input.viewingChannelId) return "none";
  return "toast";
}

/** Append a toast, keeping only the newest `max` (≥ 1). Never mutates `prev`. */
export function enqueueToast<T>(prev: readonly T[], item: T, max: number = MAX_VISIBLE_TOASTS): T[] {
  const keep = Math.max(1, Math.floor(max));
  return [...prev, item].slice(-keep);
}

/**
 * Turn a raw agent reply into a one-line, plain-text preview:
 * strips 0G / upload markers, tool-call lines, markdown syntax and links; collapses whitespace;
 * truncates on a word boundary with an ellipsis.
 */
export function toastPreview(raw: string | null | undefined, maxChars: number = TOAST_PREVIEW_CHARS): string {
  if (!raw) return "";
  const { text } = parseMarkers(raw);
  const plain = text
    .split("\n")
    .filter((l) => !/^\s*(\[tool:|→|←)/.test(l))
    .join(" ")
    .replace(/```[\s\S]*?```/g, " ")              // fenced code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")      // images → alt text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")       // links → text
    .replace(/`([^`]*)`/g, "$1")                   // inline code
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, "$2") // bold / italic / strike
    .replace(/(^|\s)(#{1,6}|>|[-*+]|\d+\.)\s+/g, "$1") // headings, quotes, list markers
    .replace(/\s+/g, " ")
    .trim();
  const limit = Math.max(1, Math.floor(maxChars));
  if (plain.length <= limit) return plain;
  const cut = plain.slice(0, limit);
  const space = cut.lastIndexOf(" ");
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?-]+$/, "")}…`;
}
