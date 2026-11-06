"use client";
import { useEffect, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  children: React.ReactNode;
  wide?: boolean;
  /** Larger than `wide` — for dense forms (e.g. Create Agent). */
  extraWide?: boolean;
  steps?: { total: number; current: number };
  maxHeight?: string;
}

export default function Modal({ title, subtitle, onClose, onConfirm, confirmLabel = "Confirm", confirmDisabled, children, wide, extraWide, steps, maxHeight }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Portalled to <body>: a drawer's CSS transform would otherwise trap position: fixed inside the drawer.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={onClose}
    >
      <div
        className={`relative rounded-lg p-6 flex flex-col gap-4 max-w-[95vw] max-[767px]:w-full max-[767px]:max-w-full max-[767px]:h-full max-[767px]:rounded-none max-[767px]:overflow-y-auto max-[767px]:pt-[calc(24px+env(safe-area-inset-top))] max-[767px]:pb-[calc(24px+env(safe-area-inset-bottom))] ${
          extraWide ? "w-[min(880px,95vw)]" : wide ? "w-[600px]" : "w-[440px]"
        }`}
        style={{ background: "var(--bf-primary)" }}
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="min-[768px]:hidden absolute right-2 top-[calc(8px+env(safe-area-inset-top))] w-11 h-11 flex items-center justify-center rounded-lg z-10"
          style={{ color: "var(--foreground)" }}
        >
          <X size={20} />
        </button>
        <div className="max-[767px]:pr-10">
          {steps && (
            <div className="flex gap-1.5 mb-3">
              {Array.from({ length: steps.total }).map((_, i) => (
                <div key={i} style={{
                  flex: 1, height: 3, borderRadius: 2,
                  background: i < steps.current ? "var(--bf-accent)" : "var(--bf-quinary)",
                  opacity: i === steps.current - 1 ? 1 : i < steps.current - 1 ? 0.55 : 0.35,
                }} />
              ))}
            </div>
          )}
          <h2 className="text-[var(--foreground)] text-xl font-bold">{title}</h2>
          {subtitle && <p className="text-sm mt-2.5 leading-relaxed" style={{ color: "var(--bf-gray)" }}>{subtitle}</p>}
        </div>
        {/* Small horizontal (and vertical) padding when scrollable so focus rings
            aren’t clipped by the overflow scrollport (overflow-y: auto implies
            horizontal clipping of descendant overflow too). */}
        <div
          className={`flex flex-col gap-4${maxHeight ? " px-2 py-1" : ""}`}
          style={maxHeight ? { overflowY: "auto", maxHeight } : undefined}
        >
          {children}
        </div>
        {onConfirm && (
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="px-4 py-2 text-[var(--foreground)] text-sm rounded hover:underline">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={confirmDisabled}
              className="px-5 py-2 text-sm font-semibold rounded disabled:opacity-40 disabled:cursor-default"
              style={{ background: "var(--bf-accent)", color: "var(--bf-primary)" }}
            >
              {confirmLabel}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ModalLabel({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <label
      className={`block text-xs font-semibold uppercase tracking-wider mb-1.5 ${className ?? ""}`}
      style={{ color: "var(--bf-gray)", ...style }}
    >
      {children}
    </label>
  );
}

export function ModalInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded px-3 py-2.5 text-sm text-[var(--on-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--bf-accent)] ${props.className ?? ""}`}
      style={{ background: "var(--bf-quaternary)", border: "1px solid transparent", ...props.style }}
    />
  );
}

export function ModalTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full rounded px-3 py-2.5 text-sm text-[var(--on-ink)] focus:outline-none focus:ring-1 focus:ring-[var(--bf-accent)] resize-none ${props.className ?? ""}`}
      style={{ background: "var(--bf-quaternary)", border: "1px solid transparent", ...props.style }}
    />
  );
}
