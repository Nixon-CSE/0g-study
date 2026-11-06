"use client";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** Phones: the server rail and DM list are hidden on these pages, so this is the way back. */
export default function PhoneBackBar({ title }: { title: string }) {
  return (
    <div className="flex min-[768px]:hidden items-center gap-1 px-1 h-12 flex-shrink-0 border-b" style={{ background: "var(--bf-primary)", borderColor: "var(--bf-quinary)" }}>
      <Link href="/workspace" aria-label="Back to Study" className="w-11 h-11 flex items-center justify-center" style={{ color: "var(--foreground)" }}>
        <ChevronLeft size={22} />
      </Link>
      <span className="flex-1 min-w-0 truncate font-bold text-[var(--foreground)]">{title}</span>
    </div>
  );
}
