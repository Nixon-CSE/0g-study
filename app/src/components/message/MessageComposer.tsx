"use client";
import { useState, useRef, useEffect } from "react";
import { Plus, Smile, Gift, Volume2 } from "lucide-react";
import type { Channel, Agent } from "@/context/AppContext";
import Avatar from "@/components/shared/Avatar";
import { agentStudyFetch } from "@/lib/agent-study";
import { withUploadMarker } from "@/lib/study-markers";
import { photoDecodeError } from "@/lib/responsive";

interface Props {
  channel: Channel;
  onSend: (text: string) => void;
  agents?: Agent[];
}

const SLASH_COMMANDS = [
  { cmd: "/search",   desc: "Search the web (ResearchBot)" },
  { cmd: "/summarise",desc: "Summarise a URL or text (ResearchBot)" },
  { cmd: "/review",   desc: "Code review (CodeAssist)" },
  { cmd: "/write",    desc: "Write code from spec (CodeAssist)" },
  { cmd: "/balance",  desc: "Show server balance" },
  { cmd: "/agents",   desc: "List server agents" },
  { cmd: "/help",     desc: "Show all commands" },
];

export default function MessageComposer({ channel, onSend, agents = [] }: Props) {
  const [text, setText] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Downscale to <=1280px JPEG, upload to the agent runtime, keep the id until send.
  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      // Separate from the upload's error handling: "can't decode" needs its own message.
      const bmp = await createImageBitmap(file).catch(() => null);
      if (!bmp) { setUploadError(photoDecodeError(file)); return; }
      const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const res = await agentStudyFetch("/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.id) setUploadId(j.id);
      else setUploadError(res.status === 429 ? "daily photo limit reached" : res.status === 413 ? "photo too large" : "upload failed — try again");
    } catch { setUploadError("upload failed — try again"); }
    finally { setUploading(false); }
  };

  // FR6: after the Examiner replies, prefill the composer so the quiz loop needs no re-mention.
  const lastMsg = channel.messages[channel.messages.length - 1];
  const lastIsExaminer = !!lastMsg?.isBot &&
    agents.some(a => (a.slug === "study-examiner") && (a.id === lastMsg.authorId || a.name === lastMsg.author));
  const lastId = lastMsg?.id;
  useEffect(() => {
    if (lastIsExaminer) setText(t => (t.trim() === "" ? "@study-examiner " : t));
  }, [lastId, lastIsExaminer]);

  // Detect @mention at the tail of the input (no space after @)
  const mentionMatch = text.match(/@([a-z0-9_-]*)$/i);
  const mentionPartial = mentionMatch ? mentionMatch[1].toLowerCase() : null;

  const filteredAgents = mentionPartial !== null && !mentionDismissed
    ? agents.filter(a =>
        (a.slug ?? a.name).toLowerCase().includes(mentionPartial) ||
        a.name.toLowerCase().includes(mentionPartial)
      ).slice(0, 6)
    : [];

  const filteredCmds = SLASH_COMMANDS.filter(c =>
    text.startsWith("/") && c.cmd.startsWith(text.split(" ")[0])
  );

  const showMentions = filteredAgents.length > 0;
  const showCommands = !showMentions && text.startsWith("/") && filteredCmds.length > 0;

  const insertMention = (agent: Agent) => {
    const slug = agent.slug ?? agent.name.toLowerCase().replace(/\s+/g, "-");
    setText(prev => prev.replace(/@([a-z0-9_-]*)$/i, `@${slug} `));
    setMentionDismissed(false);
    inputRef.current?.focus();
  };

  const send = () => {
    if (!text.trim() && !uploadId) return;
    onSend(withUploadMarker(text, uploadId));
    setUploadId(null);
    setText("");
    setMentionDismissed(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (showMentions) {
      if (e.key === "ArrowDown") { e.preventDefault(); setMentionIndex(i => Math.min(i + 1, filteredAgents.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setMentionIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); insertMention(filteredAgents[mentionIndex]); return; }
      if (e.key === "Escape") { setMentionDismissed(true); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // Touch devices get the camera as a choice. With a mouse the file picker opens as before.
  const attach = () => {
    if (window.matchMedia?.("(pointer: coarse)").matches) setAttachOpen((o) => !o);
    else fileRef.current?.click();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    setMentionDismissed(false);
    setMentionIndex(0);
  };

  if (channel.type === "voice") {
    return (
      <div className="px-4 pb-6">
        <div
          className="rounded-lg flex items-center gap-3 px-4 py-4"
          style={{ background: "var(--bf-chat-input)" }}
        >
          <Volume2 size={22} style={{ color: "var(--bf-symbol)" }} strokeWidth={1.5} />
          <span style={{ color: "var(--bf-gray)" }}>
            Voice channel — join to speak with agents
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 max-[767px]:px-2 pb-6 max-[767px]:pb-2 relative">
      {/* Take a photo or pick one (touch devices) */}
      {attachOpen && (
        <div
          className="absolute bottom-full left-2 mb-1 rounded-lg overflow-hidden shadow-2xl border z-20"
          style={{ background: "var(--bf-quaternary)", borderColor: "var(--bf-quinary)" }}
        >
          {([["Take photo", cameraRef], ["Choose from library", fileRef]] as const).map(([label, ref]) => (
            <button
              key={label}
              type="button"
              onClick={() => { setAttachOpen(false); ref.current?.click(); }}
              className="block w-full min-h-[44px] px-4 text-left text-sm font-semibold text-[var(--foreground)]"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* @ mention autocomplete */}
      {showMentions && (
        <div
          className="absolute bottom-full left-4 right-4 mb-1 rounded-lg overflow-hidden shadow-2xl border"
          style={{ background: "var(--bf-quaternary)", borderColor: "var(--bf-quinary)" }}
        >
          <p
            className="text-xs px-3 py-1.5 uppercase tracking-wider font-semibold border-b"
            style={{ color: "var(--bf-gray)", borderColor: "var(--bf-quinary)" }}
          >
            Agents
          </p>
          {filteredAgents.map((agent, i) => (
            <button
              key={agent.id}
              onClick={() => insertMention(agent)}
              className="flex items-center gap-3 w-full px-3 py-2 min-h-[44px] text-left transition-colors"
              style={{ background: i === mentionIndex ? "var(--bf-quinary)" : "transparent" }}
              onMouseEnter={() => setMentionIndex(i)}
            >
              <Avatar name={agent.name} size={24} src={agent.avatar} color="var(--bf-fire)" className="flex-shrink-0" />
              <span className="text-sm font-semibold text-[var(--foreground)] truncate">{agent.name}</span>
              {agent.slug && (
                <span className="text-xs font-mono truncate" style={{ color: "var(--bf-gray)" }}>@{agent.slug}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Slash command autocomplete */}
      {showCommands && (
        <div
          className="absolute bottom-full left-4 right-4 mb-1 rounded-lg overflow-hidden shadow-2xl border"
          style={{ background: "var(--bf-quaternary)", borderColor: "var(--bf-quinary)" }}
        >
          <p
            className="text-xs px-3 py-1.5 uppercase tracking-wider font-semibold border-b"
            style={{ color: "var(--bf-gray)", borderColor: "var(--bf-quinary)" }}
          >
            Commands
          </p>
          {filteredCmds.map(c => (
            <button
              key={c.cmd}
              onClick={() => {
                setText(c.cmd + " ");
                inputRef.current?.focus();
              }}
              className="flex items-center gap-3 w-full px-3 py-2 min-h-[44px] text-left transition-colors hover:bg-[var(--bf-quinary)]"
            >
              <code className="text-sm font-bold" style={{ color: "var(--bf-accent)" }}>{c.cmd}</code>
              <span className="text-sm" style={{ color: "var(--bf-gray)" }}>{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input bar */}
      <div
        className="rounded-lg flex items-center"
        style={{ background: "var(--bf-chat-input)" }}
      >
        {/* Attach / upload button */}
        <button
          className="flex-shrink-0 w-11 h-11 flex items-center justify-center transition-colors"
          style={{ color: "var(--bf-symbol)" }}
          title={uploadId ? "Notes photo attached" : uploading ? "Uploading…" : "Attach notes photo"}
          aria-label="Attach notes photo"
          onClick={attach}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--bf-gray)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--bf-symbol)"; }}
        >
          <Plus size={22} strokeWidth={2} />
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
        />
        {(uploadId || uploading) && (
          <span className="text-xs flex-shrink-0 pr-2" style={{ color: "var(--bf-accent)" }}>
            {uploading ? "uploading…" : "📎 notes attached"}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={handleChange}
          onKeyDown={handleKey}
          placeholder={`Message #${channel.name}`}
          className="flex-1 min-w-0 bg-transparent py-2.5 text-sm max-[767px]:text-base text-[var(--foreground)] focus:outline-none placeholder-[var(--bf-gray)]"
          style={{ color: "var(--bf-white)" }}
        />

        {/* Right icons */}
        <div className="flex items-center gap-0.5 pr-2 flex-shrink-0 max-[767px]:hidden">
          <ComposerBtn title="Send a gift"><Gift size={20} strokeWidth={1.5} /></ComposerBtn>
          <ComposerBtn title="Emoji"><Smile size={20} strokeWidth={1.5} /></ComposerBtn>
        </div>
      </div>
      {uploadError && !uploading && !uploadId && (
        <p className="text-xs px-1 pt-1" role="alert" style={{ color: "var(--bf-red, #a8372f)" }}>{uploadError}</p>
      )}
    </div>
  );
}

function ComposerBtn({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <button
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded transition-colors"
      style={{ color: "var(--bf-symbol)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--bf-gray)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--bf-symbol)"; }}
    >
      {children}
    </button>
  );
}
