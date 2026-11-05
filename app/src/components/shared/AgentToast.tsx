"use client";
import { useEffect, useRef, useState } from "react";
import { X, CheckCircle2, Wrench } from "lucide-react";

export interface AgentToastItem {
  id: string;
  agentName: string;
  agentAvatar?: string;
  message: string;
  /** true = tool/task completed, false = plain reply */
  isTask: boolean;
}

interface Props {
  toasts: AgentToastItem[];
  onDismiss: (id: string) => void;
}

function SingleToast({ toast, onDismiss }: { toast: AgentToastItem; onDismiss: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDismiss, 5000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [onDismiss]);

  const preview = toast.message.length > 80 ? toast.message.slice(0, 80) + "…" : toast.message;

  return (
    <div
      className="flex items-start gap-3 rounded-xl px-4 py-3 shadow-2xl"
      style={{
        background: "var(--bf-secondary)",
        border: "1px solid var(--bf-quinary)",
        minWidth: 280,
        maxWidth: 360,
        animation: "bf-slide-in 0.2s ease-out",
      }}
    >
      {/* Icon */}
      <div
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
        style={{ background: toast.isTask ? "rgba(110,134,214,0.15)" : "rgba(251,146,60,0.12)" }}
      >
        {toast.isTask
          ? <CheckCircle2 size={15} style={{ color: "var(--bf-accent)" }} strokeWidth={2} />
          : <Wrench size={15} style={{ color: "var(--bf-fire)" }} strokeWidth={2} />
        }
      </div>

      {/* Text */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold" style={{ color: "var(--bf-accent)" }}>
          {toast.agentName}
          {toast.isTask && <span className="ml-1 font-normal" style={{ color: "var(--bf-gray)" }}>completed a task</span>}
        </p>
        <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "#dde1e8" }}>{preview}</p>
      </div>

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="flex-shrink-0 p-0.5 rounded hover:bg-[rgba(19,19,21,0.08)] transition-colors"
        style={{ color: "var(--bf-gray)" }}
      >
        <X size={13} />
      </button>

      {/* Progress bar */}
      <span
        className="absolute bottom-0 left-0 h-0.5 rounded-b-xl"
        style={{
          background: "var(--bf-accent)",
          animation: "bf-shrink 5s linear forwards",
          width: "100%",
        }}
      />
    </div>
  );
}

export default function AgentToastStack({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <>
      <style>{`
        @keyframes bf-slide-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bf-shrink {
          from { width: 100%; }
          to   { width: 0%; }
        }
      `}</style>
      <div
        className="fixed bottom-6 right-6 flex flex-col gap-2 z-[9999] pointer-events-none"
        style={{ alignItems: "flex-end" }}
      >
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto relative overflow-hidden">
            <SingleToast toast={t} onDismiss={() => onDismiss(t.id)} />
          </div>
        ))}
      </div>
    </>
  );
}
