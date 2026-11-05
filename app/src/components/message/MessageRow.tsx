"use client";
import { useState } from "react";
import { ShieldCheck, ShieldAlert, ChevronRight, ChevronDown, Wrench } from "lucide-react";
import type { Message } from "@/context/AppContext";
import Avatar from "@/components/shared/Avatar";
import FlameAvatar from "@/components/shared/FlameAvatar";
import { useApp } from "@/context/AppContext";
import AgentProfileModal from "@/components/agent/AgentProfileModal";
import { parseMarkers, badgeLabel } from "@/lib/study-markers";

interface ToolCall {
  name: string;
  inputLines: string[];
  outputLines: string[];
}

function parseToolCalls(content: string): ToolCall[] {
  const lines = content.split("\n").filter(Boolean);
  const calls: ToolCall[] = [];
  let current: ToolCall | null = null;

  for (const line of lines) {
    if (line.startsWith("[tool:")) {
      if (current) calls.push(current);
      const nameMatch = line.match(/^\[tool:\s*([^\]]+)\]/);
      const name = nameMatch ? nameMatch[1].trim() : "tool";
      const rest = line.replace(/^\[tool:[^\]]+\]\s*/, "").trim();
      current = { name, inputLines: rest ? [rest] : [], outputLines: [] };
    } else if (line.startsWith("→")) {
      if (!current) current = { name: "tool", inputLines: [], outputLines: [] };
      current.inputLines.push(line.slice(1).trim());
    } else if (line.startsWith("←")) {
      if (!current) current = { name: "tool", inputLines: [], outputLines: [] };
      current.outputLines.push(line.slice(1).trim());
    }
  }
  if (current) calls.push(current);
  return calls;
}

// Tool call block — Discord-thread style
function ToolCallThread({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const calls = parseToolCalls(content);

  if (calls.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
        style={{
          background: open ? "var(--bf-quinary)" : "var(--bf-quaternary)",
          color: "var(--bf-accent)",
          border: "1px solid var(--bf-quinary)",
        }}
      >
        <Wrench size={12} strokeWidth={2} />
        <span className="font-semibold">{calls.length} tool call{calls.length !== 1 ? "s" : ""}</span>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>

      {open && (
        <div className="mt-2 flex gap-0">
          {/* Discord-style vertical thread connector */}
          <div
            className="flex-shrink-0 rounded-full"
            style={{ width: 2, background: "var(--bf-accent)", opacity: 0.5, marginLeft: 10, marginRight: 10 }}
          />
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            {calls.map((call, i) => (
              <div
                key={i}
                className="rounded-lg overflow-hidden"
                style={{ border: "1px solid var(--bf-quinary)" }}
              >
                {/* Tool name chip */}
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5"
                  style={{ background: "var(--bf-quaternary)", borderBottom: "1px solid var(--bf-quinary)" }}
                >
                  <Wrench size={10} strokeWidth={2} style={{ color: "var(--bf-accent)" }} />
                  <code className="text-xs font-bold" style={{ color: "var(--bf-accent)" }}>{call.name}</code>
                </div>

                {/* Input */}
                {call.inputLines.length > 0 && (
                  <div className="px-3 py-2" style={{ background: "var(--bf-tertiary)" }}>
                    {call.inputLines.map((l, j) => (
                      <p key={j} className="text-xs font-mono leading-relaxed" style={{ color: "var(--bf-gray)" }}>{l}</p>
                    ))}
                  </div>
                )}

                {/* Output */}
                {call.outputLines.length > 0 && (
                  <div
                    className="px-3 py-2"
                    style={{ background: "var(--bf-primary)", borderTop: "1px solid var(--bf-quinary)" }}
                  >
                    {call.outputLines.map((l, j) => (
                      <p key={j} className="text-xs font-mono leading-relaxed" style={{ color: "var(--bf-fire)" }}>{l}</p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Detect if a message contains tool call markers
function hasToolCalls(content: string): boolean {
  return content.includes("[tool:") || (content.includes("→") && content.includes("←"));
}

export default function MessageRow({ msg: rawMsg }: { msg: Message }) {
  const parsed = parseMarkers(rawMsg.content);
  const zgIds = parsed.requestIds;
  const hasUpload = parsed.uploadIds.length > 0;
  const msg: Message = { ...rawMsg, content: parsed.text };
  const [showVerify, setShowVerify] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const { activeServer } = useApp();
  const agentObj = msg.isBot ? activeServer?.agents.find(a => a.id === msg.authorId) : undefined;

  // Split content into visible text and tool-call section
  const lines = msg.content.split("\n");
  const firstToolIdx = lines.findIndex(l => l.startsWith("[tool:") || (l.startsWith("→") && lines.some(x => x.startsWith("←"))));
  const visibleContent = firstToolIdx > 0
    ? lines.slice(0, firstToolIdx).join("\n").trim()
    : (hasToolCalls(msg.content) ? "" : msg.content);
  const toolContent = firstToolIdx >= 0 ? lines.slice(firstToolIdx).join("\n") : (hasToolCalls(msg.content) ? msg.content : "");

  return (
    <>
    <div
      className="flex gap-3 px-4 py-1.5 group rounded-lg transition-colors"
      onMouseEnter={e => (e.currentTarget.style.background = "var(--bf-quinary)")}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
    >
      {msg.isBot ? (
        <FlameAvatar
          slug={agentObj?.slug || agentObj?.id || msg.author}
          avatarUrl={agentObj?.avatar ?? msg.avatar}
          size={42}
          className="mt-0.5"
          alt={msg.author}
        />
      ) : (
        <Avatar
          name={msg.author}
          size={42}
          color="var(--bf-plum)"
          src={msg.avatar}
          className="mt-0.5 flex-shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {msg.isBot && agentObj ? (
            <button
              onClick={() => setShowProfile(true)}
              className="font-bold text-[var(--foreground)] hover:underline transition-colors text-left"
            >
              {msg.author}
            </button>
          ) : (
            <span className="font-bold text-[var(--foreground)]">{msg.author}</span>
          )}
          {msg.isBot && (
            <span
              className="text-[var(--on-ink)] font-bold uppercase"
              style={{ fontSize: 9, background: "var(--bf-accent)", padding: "2px 5px", borderRadius: 4 }}
            >
              BOT
            </span>
          )}
          <span className="text-xs" style={{ color: "var(--bf-symbol)" }}>{msg.date}</span>
          {msg.cost !== undefined && (
            <span className="text-xs" style={{ color: "var(--bf-gray)" }}>· {msg.cost.toFixed(4)} 0G</span>
          )}
          {zgIds.length > 0 && (
            <button
              onClick={() => navigator.clipboard?.writeText(zgIds.join(",")).catch(() => {})}
              title={`0G Private Computer request id${zgIds.length > 1 ? "s" : ""} (click to copy):\n${zgIds.join("\n")}`}
              className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md font-mono"
              style={{ color: "var(--bf-accent)", background: "rgba(129,22,224,0.12)" }}
            >
              <ShieldCheck size={12} strokeWidth={2} />
              {badgeLabel(zgIds)}
            </button>
          )}
          {hasUpload && (
            <span className="text-xs px-1.5 py-0.5 rounded-md" style={{ color: "var(--bf-gray)", background: "var(--bf-quaternary)" }}>
              📎 notes photo
            </span>
          )}
          {msg.teeHash && (
            <button
              onClick={() => setShowVerify(!showVerify)}
              className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md"
              style={{ color: "var(--bf-accent)", background: "rgba(129,22,224,0.12)" }}
            >
              <ShieldCheck size={12} strokeWidth={2} />
              TEE Verified
            </button>
          )}
        </div>

        {visibleContent && (
          <p className="text-sm leading-relaxed mt-0.5" style={{ color: "#dde1e8" }}>{visibleContent}</p>
        )}

        {toolContent && <ToolCallThread content={toolContent} />}

        {showVerify && msg.teeHash && (
          <div className="mt-2 rounded-lg p-2.5 text-xs font-mono" style={{ background: "var(--bf-quaternary)", color: "var(--bf-gray)" }}>
            <p className="font-semibold text-[var(--on-ink)] mb-1 flex items-center gap-1.5">
              <ShieldAlert size={13} strokeWidth={2} style={{ color: "var(--bf-accent)" }} />
              TEE Attestation Report
            </p>
            <p>Hash: <span style={{ color: "var(--bf-accent)" }}>{msg.teeHash}</span></p>
            <p>Provider: 0G Compute Network</p>
            <p>Status: <span style={{ color: "var(--bf-accent)" }}>Verified</span></p>
          </div>
        )}
      </div>
    </div>
    {showProfile && agentObj && (
      <AgentProfileModal agent={agentObj} onClose={() => setShowProfile(false)} />
    )}
    </>
  );
}
