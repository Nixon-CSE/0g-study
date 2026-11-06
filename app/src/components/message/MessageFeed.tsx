"use client";
import { useEffect, useRef } from "react";
import type { Message } from "@/context/AppContext";
import { useApp } from "@/context/AppContext";
import { resolveGreetingName, greetingUsesFallback } from "@/lib/greeting-name";
import { emptyChannelHint } from "@/lib/empty-state";
import MessageRow from "./MessageRow";

export default function MessageFeed({ messages }: { messages: Message[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { user, preferredName, activeServer } = useApp();

  const displayName = resolveGreetingName(preferredName, user.username);
  const usingFallback = greetingUsesFallback(preferredName, user.username);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto py-4 flex flex-col gap-0.5">
      {messages.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-center px-8" style={{ color: "var(--bf-gray)" }}>
          <div>
            <p className="text-xl font-bold text-[var(--foreground)] mb-2">
              Hey,{" "}
              <span
                style={{
                  color: usingFallback ? "var(--bf-gray)" : "var(--foreground)",
                  fontStyle: usingFallback ? "italic" : "normal",
                  marginRight: usingFallback ? "0.15em" : 0,
                }}
              >
                {displayName}
              </span>
              !
            </p>
            <p className="text-sm">{emptyChannelHint(activeServer?.agents?.length)}</p>
          </div>
        </div>
      )}
      {messages.map(msg => <MessageRow key={msg.id} msg={msg} />)}
    </div>
  );
}
