"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Plus, Trash2, Upload, FileText, Type, ArrowLeft, Loader2 } from "lucide-react";
import { bf, type KnowledgeDoc } from "@/lib/api-bonfire";
import { useApp } from "@/context/AppContext";
import Modal, { ModalLabel, ModalInput, ModalTextarea } from "@/components/shared/Modal";

const MAX_UPLOAD_BYTES = 512 * 1024;
const ALLOWED_EXT = /\.(md|markdown|txt)$/i;

export default function KnowledgePanel({ serverId }: { serverId: string }) {
  const { user, activeServer } = useApp();
  const isAdmin = useMemo(() => {
    if (!activeServer) return false;
    return activeServer.ownerId === user.id;
  }, [activeServer, user.id]);

  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<(KnowledgeDoc & { content: string }) | null>(null);
  const [openDocLoading, setOpenDocLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const { docs } = await bf.listKnowledge(serverId);
      setDocs(docs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load knowledge");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [serverId]);

  const handleOpen = async (doc: KnowledgeDoc) => {
    setOpenDocLoading(true);
    try {
      const { doc: full } = await bf.getKnowledge(serverId, doc.id);
      setOpenDoc(full);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open doc");
    } finally {
      setOpenDocLoading(false);
    }
  };

  const handleDelete = async (doc: KnowledgeDoc) => {
    if (!confirm(`Delete "${doc.title}"? This can't be undone.`)) return;
    try {
      await bf.deleteKnowledge(serverId, doc.id);
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      if (openDoc?.id === doc.id) setOpenDoc(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  if (openDoc) {
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "var(--bf-primary)" }}>
        <DocHeader doc={openDoc} onBack={() => setOpenDoc(null)} canDelete={isAdmin} onDelete={() => handleDelete(openDoc)} />
        <pre
          className="flex-1 overflow-auto px-6 py-4 text-sm text-[var(--foreground)] whitespace-pre-wrap"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: 1.55 }}
        >
          {openDoc.content}
        </pre>
      </div>
    );
  }

  return (
    <>
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden" style={{ background: "var(--bf-primary)" }}>
        <header
          className="flex items-center gap-3 px-4 h-14 border-b flex-shrink-0"
          style={{ borderColor: "var(--bf-quinary)" }}
        >
          <BookOpen size={22} style={{ color: "var(--bf-fire)" }} strokeWidth={1.8} />
          <span className="font-bold text-[var(--on-ink)] text-lg">knowledge-base</span>
          <span className="w-px h-5 mx-1 flex-shrink-0" style={{ background: "var(--bf-quinary)" }} />
          <span className="text-sm truncate text-[var(--on-ink-muted)]">
            Shared notes — auto-fed into every agent on this server.
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: "var(--bf-accent)", color: "var(--on-ink)" }}
          >
            <Plus size={16} strokeWidth={2.5} />
            Add document
          </button>
        </header>

        {error && (
          <div
            className="mx-4 mt-4 px-4 py-3 rounded-xl text-sm"
            style={{ background: "rgba(240,91,91,0.12)", color: "#a8372f", border: "1px solid rgba(240,91,91,0.3)" }}
          >
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-[var(--foreground)]">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : docs.length === 0 ? (
            <EmptyState onAdd={() => setShowAdd(true)} />
          ) : (
            <ul className="flex flex-col gap-2">
              {docs.map((d) => (
                <li key={d.id}>
                  <DocRow
                    doc={d}
                    onOpen={() => handleOpen(d)}
                    canDelete={isAdmin}
                    onDelete={() => handleDelete(d)}
                    loading={openDocLoading}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>

      {showAdd && (
        <AddDocModal
          serverId={serverId}
          onClose={() => setShowAdd(false)}
          onAdded={(doc) => {
            setDocs((prev) => [doc, ...prev]);
            setShowAdd(false);
          }}
        />
      )}
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function DocRow({
  doc,
  onOpen,
  canDelete,
  onDelete,
  loading,
}: {
  doc: KnowledgeDoc;
  onOpen: () => void;
  canDelete: boolean;
  onDelete: () => void;
  loading: boolean;
}) {
  const time = new Date(doc.createdAt).toLocaleString();
  const sizeKb = (doc.sizeBytes / 1024).toFixed(1);
  return (
    <div
      className="flex items-center gap-3 px-3 py-3 rounded-xl transition-colors"
      style={{ background: "var(--bf-secondary)", border: "1px solid var(--bf-quinary)" }}
    >
      <button onClick={onOpen} disabled={loading} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "var(--bf-quaternary)", color: doc.source === "upload" ? "var(--bf-accent)" : "var(--bf-fire)" }}
        >
          {doc.source === "upload" ? <FileText size={18} strokeWidth={1.8} /> : <Type size={18} strokeWidth={1.8} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[var(--foreground)] text-sm font-semibold truncate">{doc.title}</p>
          <p className="text-xs mt-0.5 truncate" style={{ color: "var(--bf-gray)" }}>
            {doc.source === "upload" ? `${doc.filename ?? "file"} · ` : ""}
            {sizeKb} KB · {time}
          </p>
        </div>
      </button>
      {canDelete && (
        <button
          onClick={onDelete}
          title="Delete document"
          className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
          style={{ color: "var(--bf-gray)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(240,91,91,0.12)";
            (e.currentTarget as HTMLElement).style.color = "#a8372f";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--bf-gray)";
          }}
        >
          <Trash2 size={16} strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

function DocHeader({
  doc,
  onBack,
  canDelete,
  onDelete,
}: {
  doc: KnowledgeDoc;
  onBack: () => void;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <header
      className="flex items-center gap-3 px-4 h-14 border-b flex-shrink-0"
      style={{ borderColor: "var(--bf-quinary)" }}
    >
      <button
        onClick={onBack}
        title="Back to list"
        className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors"
        style={{ color: "var(--bf-gray)" }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.color = "var(--foreground)";
          (e.currentTarget as HTMLElement).style.background = "var(--bf-quinary)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.color = "var(--bf-gray)";
          (e.currentTarget as HTMLElement).style.background = "transparent";
        }}
      >
        <ArrowLeft size={18} />
      </button>
      {doc.source === "upload" ? (
        <FileText size={20} style={{ color: "var(--bf-accent)" }} strokeWidth={1.8} />
      ) : (
        <Type size={20} style={{ color: "var(--bf-fire)" }} strokeWidth={1.8} />
      )}
      <span className="font-bold text-[var(--on-ink)] text-lg truncate">{doc.title}</span>
      <div className="flex-1" />
      {canDelete && (
        <button
          onClick={onDelete}
          title="Delete"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
          style={{ background: "var(--bf-quaternary)", color: "var(--bf-red)", border: "1px solid var(--bf-quinary)" }}
        >
          <Trash2 size={15} strokeWidth={1.8} /> Delete
        </button>
      )}
    </header>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 max-w-md mx-auto">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/0G-Logo-Purple_Hero.png"
        alt="0G"
        className="h-12 w-auto mb-4 object-contain"
      />
      <p className="text-[var(--foreground)] font-bold text-lg mb-2">Build your server&apos;s knowledge base</p>
      <p className="text-sm mb-6 text-[var(--foreground)]">
        Anything you add here is automatically included in every agent&apos;s context on this server. BonFire uses 0G Storage and 0G Compute across the stack. Paste notes or upload .md / .txt files.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-[var(--on-ink)] transition-opacity hover:opacity-90"
        style={{ background: "var(--bf-accent)" }}
      >
        <Plus size={16} strokeWidth={2.5} />
        Add first document
      </button>
    </div>
  );
}

function AddDocModal({
  serverId,
  onClose,
  onAdded,
}: {
  serverId: string;
  onClose: () => void;
  onAdded: (doc: KnowledgeDoc) => void;
}) {
  const [tab, setTab] = useState<"text" | "upload">("text");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setErr(null);
    setSubmitting(true);
    try {
      if (tab === "text") {
        if (!title.trim() || !content.trim()) {
          setErr("Title and content are both required.");
          setSubmitting(false);
          return;
        }
        const { doc } = await bf.createKnowledge(serverId, { title: title.trim(), content });
        onAdded(doc);
      } else {
        if (!file) {
          setErr("Pick a .md or .txt file to upload.");
          setSubmitting(false);
          return;
        }
        if (!ALLOWED_EXT.test(file.name)) {
          setErr("Only .md, .markdown, or .txt files are accepted.");
          setSubmitting(false);
          return;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          setErr(`File is too large (max ${(MAX_UPLOAD_BYTES / 1024).toFixed(0)} KB).`);
          setSubmitting(false);
          return;
        }
        const { doc } = await bf.uploadKnowledge(serverId, { file, title: title.trim() || undefined });
        onAdded(doc);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add document");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="Add to knowledge base"
      subtitle="Anything you save here is auto-fed into every agent on this server."
      onClose={onClose}
      onConfirm={submit}
      confirmLabel={submitting ? "Saving…" : "Save"}
      confirmDisabled={submitting}
      wide
    >
      <div
        className="flex gap-1 p-1 rounded-lg w-fit"
        style={{ background: "var(--bf-quaternary)", border: "1px solid var(--bf-quinary)" }}
      >
        <TabButton active={tab === "text"} onClick={() => setTab("text")}>
          <Type size={14} /> Type content
        </TabButton>
        <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
          <Upload size={14} /> Upload .md / .txt
        </TabButton>
      </div>

      {tab === "text" && (
        <>
          <div>
            <ModalLabel>Title</ModalLabel>
            <ModalInput
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Onboarding playbook"
              maxLength={200}
            />
          </div>
          <div>
            <ModalLabel>Content (Markdown supported)</ModalLabel>
            <ModalTextarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste or type notes that every agent on this server should know…"
              rows={10}
            />
          </div>
        </>
      )}

      {tab === "upload" && (
        <>
          <div>
            <ModalLabel>Title (optional — defaults to filename)</ModalLabel>
            <ModalInput
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Custom title…"
              maxLength={200}
            />
          </div>
          <div>
            <ModalLabel>File</ModalLabel>
            <button
              onClick={() => fileRef.current?.click()}
              className="w-full px-4 py-6 rounded-lg flex flex-col items-center gap-2 text-sm transition-colors"
              style={{
                background: "var(--bf-quaternary)",
                border: "1px dashed var(--bf-quinary)",
                color: file ? "var(--foreground)" : "var(--bf-gray)",
              }}
            >
              <Upload size={20} />
              {file ? (
                <>
                  <span className="text-[var(--foreground)] font-semibold">{file.name}</span>
                  <span className="text-xs" style={{ color: "var(--bf-gray)" }}>
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                </>
              ) : (
                <>
                  <span>Click to choose a .md or .txt file</span>
                  <span className="text-xs">max {(MAX_UPLOAD_BYTES / 1024).toFixed(0)} KB</span>
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </>
      )}

      {err && (
        <p
          className="text-sm px-3 py-2 rounded-lg"
          style={{ background: "rgba(240,91,91,0.12)", color: "#a8372f", border: "1px solid rgba(240,91,91,0.3)" }}
        >
          {err}
        </p>
      )}
    </Modal>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold transition-colors"
      style={{
        background: active ? "var(--bf-quinary)" : "transparent",
        color: active ? "var(--foreground)" : "var(--bf-gray)",
      }}
    >
      {children}
    </button>
  );
}
