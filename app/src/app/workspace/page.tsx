"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import AppShell from "@/components/layout/AppShell";

function Loading() {
  return (
    <div
      className="h-full w-full flex items-center justify-center"
      style={{ background: "var(--bf-primary)" }}
    >
      <div className="text-center" style={{ color: "var(--bf-gray)" }}>
        <p className="text-[var(--foreground)] font-semibold">Loading…</p>
        {!process.env.NEXT_PUBLIC_PRIVY_APP_ID && (
          <p className="mx-auto mt-3 max-w-xs text-[13px]" style={{ color: "var(--muted)" }}>
            Sign-in is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID in app/.env.local (copy .env.local.example), then restart the dev server.
          </p>
        )}
      </div>
    </div>
  );
}

export default function WorkspacePage() {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "guest") {
      router.push("/login");
    }
  }, [status, router]);

  if (status === "unknown") return <Loading />;
  if (status === "guest") return null;

  return <AppShell />;
}
