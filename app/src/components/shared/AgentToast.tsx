"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { X, CheckCircle2, Wrench } from "lucide-react";
import { TOAST_TTL_MS } from "@/lib/agent-toast-policy";

export interface AgentToastItem {
  id: string;
  agentName: string;
  agentAvatar?: string;
  /** Already a plain-text preview (see toastPreview). */
  message: string;
  /** true = tool/task completed, false = plain reply */
  isTask: boolean;
}

interface Props {
  toasts: AgentToastItem[];
  onDismiss: (id: string) => void;
}

/**
 * One toast. The auto-dismiss timer is keyed on the toast id only, and the latest `onDismiss` is read
 * through a ref. (Previously the timer depended on an inline callback that changed on every parent
 * render, so it kept restarting and toasts never went away.) Hovering or focusing pauses the timer.
 */
function SingleToast({ toast, onDismiss }: { toast: AgentToastItem; onDismiss: (id: string) => void }) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(TOAST_TTL_MS);
  const startedRef = useRef(0);

  const close = useCallback(() => dismissRef.current(toast.id), [toast.id]);

  useEffect(() => {
    if (paused) return;
    startedRef.current = Date.now();
    const t = setTimeout(close, Math.max(0, remainingRef.current));
    return () => {
      clearTimeout(t);
      remainingRef.current -= Date.now() - startedRef.current;
    };
  }, [paused, close]);

  return (
    <div
      role="status"
      className="relative flex items-start gap-3 rounded-xl px-4 py-3 shadow-2xl overflow-hidden"
      style={{
        background: "var(--bf-secondary)",
        border: "1px solid var(--bf-quinary)",
        width: "min(360px, calc(100vw - 32px))",
        animation: "bf-slide-in 0.2s ease-out",
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}
    >
      <div
        aria-hidden
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: toast.isTask ? "rgba(110,134,214,0.15)" : "rgba(251,146,60,0.12)" }}
      >
        {toast.isTask
          ? <CheckCircle2 size={15} style={{ color: "var(--bf-accent)" }} strokeWidth={2} />
          : <Wrench size={15} style={{ color: "var(--bf-fire)" }} strokeWidth={2} />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold truncate" style={{ color: "var(--foreground)" }}>
          {toast.agentName}
          {toast.isTask && <span className="ml-1 font-normal" style={{ color: "var(--bf-gray)" }}>completed a task</span>}
        </p>
        {toast.message && (
          <p className="text-xs mt-0.5 leading-relaxed line-clamp-2 break-words" style={{ color: "var(--muted)" }}>
            {toast.message}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={close}
        aria-label={`Dismiss notification from ${toast.agentName}`}
        className="flex-shrink-0 p-0.5 rounded hover:bg-[rgba(19,19,21,0.08)] focus-visible:outline focus-visible:outline-2 transition-colors"
        style={{ color: "var(--bf-gray)" }}
      >
        <X size={13} />
      </button>

      <span
        aria-hidden
        className="absolute bottom-0 left-0 h-0.5"
        style={{
          background: "var(--bf-accent)",
          width: "100%",
          animation: `bf-shrink ${TOAST_TTL_MS}ms linear forwards`,
          animationPlayState: paused ? "paused" : "running",
        }}
      />
    </div>
  );
}

/**
 * Stack anchored bottom-right, raised above the message composer (which is ~88px tall incl. padding)
 * so a toast can never cover what the user is typing.
 */
export default function AgentToastStack({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <>
      <style>{`
        @keyframes bf-slide-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
        @keyframes bf-shrink { from { width: 100%; } to { width: 0%; } }
        @media (prefers-reduced-motion: reduce) {
          [data-agent-toasts] * { animation-duration: 0.01ms !important; }
        }
      `}</style>
      <div
        data-agent-toasts
        aria-live="polite"
        className="fixed right-4 sm:right-6 flex flex-col gap-2 z-[9999] pointer-events-none"
        style={{ bottom: 104, alignItems: "flex-end" }}
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <SingleToast toast={t} onDismiss={onDismiss} />
          </div>
        ))}
      </div>
    </>
  );
}
