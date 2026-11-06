"use client";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Send, Bot, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import LeftNav from "@/components/layout/LeftNav";
import DmSidebar, { getDmSessions, upsertDmSession, type DmSession } from "@/components/dm/DmSidebar";
import FlameAvatar from "@/components/shared/FlameAvatar";

interface DmMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  time: string;
}

const LS_MESSAGES = (agentId: string) => `bonfire_dm_messages_${agentId}`;

function loadMessages(agentId: string): DmMessage[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(LS_MESSAGES(agentId)) ?? "[]");
  } catch {
    return [];
  }
}

function saveMessages(agentId: string, messages: DmMessage[]) {
  localStorage.setItem(LS_MESSAGES(agentId), JSON.stringify(messages.slice(-200)));
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function AgentAvatar({ session, size = 40 }: { session: DmSession; size?: number }) {
  return (
    <FlameAvatar
      slug={session.agentSlug}
      avatarUrl={session.agentAvatar}
      size={size}
      alt={session.agentName}
    />
  );
}

export default function DmPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const router = useRouter();
  const [session, setSession] = useState<DmSession | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load session and messages from localStorage
  useEffect(() => {
    const found = getDmSessions().find((s) => s.agentId === agentId) ?? null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(found);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(loadMessages(agentId));
  }, [agentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    if (!input.trim() || !session || sending) return;
    const text = input.trim();
    setInput("");
    setSending(true);

    const userMsg: DmMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      time: now(),
    };
    const next = [...messages, userMsg];
    setMessages(next);
    saveMessages(agentId, next);

    // Update sidebar last message
    upsertDmSession({ ...session, lastMessage: text, lastMessageAt: new Date().toISOString() });

    try {
      // Post to agent runtime
      const res = await fetch(`${session.agentBaseUrl}/chat/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "bonfire-user", text }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { streamId } = await res.json();

      // Read SSE stream
      const stream = await fetch(`${session.agentBaseUrl}/chat/stream/${streamId}`, {
        headers: { Accept: "text/event-stream" },
      });
      const reader = stream.body?.getReader();
      if (!reader) throw new Error("No stream");

      const agentMsg: DmMessage = {
        id: `a-${Date.now()}`,
        role: "agent",
        content: "",
        time: now(),
      };
      const withAgent = [...next, agentMsg];
      setMessages(withAgent);

      const decoder = new TextDecoder();
      const REPLACE = "\x00REPLACE\x00";
      let buf = "";
      let full = "";
      let currentEvent = "message";
      let doneSeen = false;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line === "") {
            if (currentEvent === "done") { doneSeen = true; break outer; }
            currentEvent = "message";
            continue;
          }
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (currentEvent === "done") continue;
          try {
            const parsed = JSON.parse(data);
            const chunk: string =
              parsed.chunk ??
              parsed.choices?.[0]?.delta?.content ??
              parsed.text ??
              parsed.content ??
              "";
            if (!chunk) continue;
            if (chunk.startsWith(REPLACE)) {
              full = chunk.slice(REPLACE.length);
            } else {
              full += chunk;
            }
            setMessages((prev) =>
              prev.map((m) => (m.id === agentMsg.id ? { ...m, content: full } : m))
            );
          } catch {
            // ignore non-JSON data lines
          }
        }
      }
      void doneSeen;

      // Persist final state
      const finalMessages = withAgent.map((m) =>
        m.id === agentMsg.id ? { ...m, content: full || "(no response)" } : m
      );
      saveMessages(agentId, finalMessages);
      upsertDmSession({
        ...session,
        lastMessage: full || "(no response)",
        lastMessageAt: new Date().toISOString(),
      });
    } catch (err) {
      const errMsg: DmMessage = {
        id: `e-${Date.now()}`,
        role: "agent",
        content: `Failed to reach agent: ${err instanceof Error ? err.message : String(err)}`,
        time: now(),
      };
      const withErr = [...next, errMsg];
      setMessages(withErr);
      saveMessages(agentId, withErr);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex h-full" style={{ background: "var(--bf-tertiary)" }}>
      <LeftNav />
      <DmSidebar />

      {/* Chat area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "var(--bf-primary)" }}>
        {/* Header */}
        <header
          className="flex items-center gap-3 px-4 h-14 border-b flex-shrink-0"
          style={{ borderColor: "var(--bf-quinary)" }}
        >
          <button
            onClick={() => router.back()}
            className="w-8 h-8 rounded flex items-center justify-center hover:bg-[var(--bf-quinary)] transition-colors md:hidden"
            style={{ color: "var(--bf-gray)" }}
          >
            <ArrowLeft size={18} />
          </button>
          {session ? (
            <>
              <AgentAvatar session={session} size={32} />
              <div>
                <p className="font-bold text-[var(--foreground)] text-sm leading-none">{session.agentName}</p>
                <p className="text-xs" style={{ color: "var(--bf-symbol)" }}>@{session.agentSlug}</p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Bot size={20} style={{ color: "var(--bf-gray)" }} />
              <span className="font-bold text-[var(--foreground)] text-sm">Loading…</span>
            </div>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3">
          {messages.length === 0 && session && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
              {session && <AgentAvatar session={session} size={64} />}
              <div>
                <p className="text-[var(--foreground)] font-bold text-lg">{session?.agentName}</p>
                <p className="text-sm mt-1" style={{ color: "var(--bf-gray)" }}>
                  This is the beginning of your direct message history with{" "}
                  <span style={{ color: "var(--bf-accent)" }}>@{session?.agentSlug}</span>.
                </p>
              </div>
            </div>
          )}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
            >
              {msg.role === "agent" && session && (
                <AgentAvatar session={session} size={32} />
              )}
              <div
                className={`max-w-[70%] flex flex-col gap-1 ${msg.role === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className="px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words"
                  style={
                    msg.role === "user"
                      ? { background: "var(--bf-accent)", color: "var(--on-ink)", borderBottomRightRadius: 4 }
                      : { background: "var(--bf-secondary)", color: "var(--foreground)", borderBottomLeftRadius: 4 }
                  }
                >
                  {msg.content || (
                    <span className="flex gap-1 items-center" style={{ color: "var(--bf-gray)" }}>
                      <span className="animate-pulse">●</span>
                      <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
                      <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: "var(--bf-symbol)" }}>{msg.time}</span>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Composer */}
        <div className="px-4 pb-4 flex-shrink-0">
          <div
            className="flex items-end gap-2 rounded-xl px-4 py-2"
            style={{ background: "var(--bf-secondary)" }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={session ? `Message @${session.agentSlug}` : "Loading…"}
              rows={1}
              disabled={!session || sending}
              className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder-[var(--bf-symbol)] resize-none focus:outline-none py-1"
              style={{ maxHeight: 120 }}
              onInput={(e) => {
                const t = e.currentTarget;
                t.style.height = "auto";
                t.style.height = `${t.scrollHeight}px`;
              }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || !session || sending}
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
              style={{
                background: input.trim() && session && !sending ? "var(--bf-accent)" : "var(--bf-quinary)",
                color: input.trim() && session && !sending ? "var(--on-ink)" : "var(--bf-gray)",
              }}
            >
              <Send size={15} />
            </button>
          </div>
          <p className="text-xs mt-1.5 text-center" style={{ color: "var(--bf-symbol)" }}>
            Messages are sent directly to the agent runtime · Press Enter to send
          </p>
        </div>
      </main>
    </div>
  );
}
