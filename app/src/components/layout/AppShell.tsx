"use client";
import { useEffect, useReducer, useRef, type TouchEvent } from "react";
import dynamic from "next/dynamic";
import { Menu, Users } from "lucide-react";
import LeftNav from "./LeftNav";
import ServerSidebar from "./ServerSidebar";
import CenterPane from "./CenterPane";
import AgentSidebar from "./AgentSidebar";
import StatusBar, { WalletCard } from "./StatusBar";
import { useApp } from "@/context/AppContext";
import { drawerReducer, isCloseSwipe, keyboardInset } from "@/lib/responsive";

// Lazy-load VoiceRoom so Daily.co JS doesn't load until needed
const VoiceRoom = dynamic(
  () => import("@/components/voice/VoiceRoom"),
  { ssr: false },
);

/** Keeps the composer above the on-screen keyboard: iOS covers the page instead of resizing it. */
function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      document.documentElement.style.setProperty("--keyboard-inset", `${keyboardInset(window.innerHeight, vv)}px`);
      if (window.scrollY) window.scrollTo(0, 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => { vv.removeEventListener("resize", update); vv.removeEventListener("scroll", update); };
  }, []);
}

const barButton = "w-11 h-11 flex items-center justify-center rounded-lg flex-shrink-0";

export default function AppShell() {
  const { activeVoiceChannelId, setActiveVoiceChannelId, activeServer, activeChannel, activeChannelId } = useApp();
  const [drawer, dispatch] = useReducer(drawerReducer, "none");
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  useKeyboardInset();

  const voiceChannel = activeServer?.channels.find(
    (c) => c.id === activeVoiceChannelId,
  );

  useEffect(() => { dispatch({ type: "close" }); }, [activeChannelId]);

  useEffect(() => {
    const onResize = () => dispatch({ type: "resize", width: window.innerWidth });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") dispatch({ type: "close" }); };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("resize", onResize); window.removeEventListener("keydown", onKey); };
  }, []);

  const onTouchStart = (e: TouchEvent) => { touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (isCloseSwipe(drawer, t.clientX - start.x, t.clientY - start.y)) dispatch({ type: "close" });
  };
  const swipe = { onTouchStart, onTouchEnd };

  return (
    <div className="flex flex-col w-full overflow-hidden" style={{ height: "calc(100% - var(--keyboard-inset, 0px))" }}>
      {/* Top bar below 1200 px: always there, because the empty and panel views have no header of their own. */}
      <div
        className="flex min-[1200px]:hidden items-center gap-1 px-1 h-12 flex-shrink-0 border-b"
        style={{ background: "var(--bf-primary)", borderColor: "var(--bf-quinary)" }}
      >
        <button
          type="button"
          aria-label="Servers and channels"
          aria-expanded={drawer === "nav"}
          onClick={() => dispatch({ type: "toggle", drawer: "nav" })}
          className={`${barButton} min-[768px]:hidden`}
          style={{ color: "var(--foreground)" }}
        >
          <Menu size={22} strokeWidth={2} />
        </button>
        <span className="flex-1 min-w-0 truncate font-bold text-[var(--foreground)] px-2">
          {activeChannel ? `# ${activeChannel.name}` : activeServer?.name ?? "0G Study"}
        </span>
        <button
          type="button"
          aria-label="Agents"
          aria-expanded={drawer === "agents"}
          onClick={() => dispatch({ type: "toggle", drawer: "agents" })}
          className={barButton}
          style={{ color: "var(--foreground)" }}
        >
          <Users size={22} strokeWidth={2} />
        </button>
      </div>

      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* Phones: a drawer. From 768 px: the normal left panes. */}
        <div
          {...swipe}
          className={`flex flex-col flex-shrink-0 max-[767px]:fixed max-[767px]:inset-y-0 max-[767px]:left-0 max-[767px]:z-40 max-[767px]:max-w-[calc(100vw-40px)] max-[767px]:transition-[transform,visibility] max-[767px]:duration-200 max-[767px]:pt-[env(safe-area-inset-top)] max-[767px]:pb-[env(safe-area-inset-bottom)] ${
            drawer === "nav" ? "" : "max-[767px]:-translate-x-full max-[767px]:invisible"
          }`}
          style={{ background: "var(--bf-secondary)" }}
        >
          <div className="flex flex-1 min-h-0">
            <LeftNav />
            <ServerSidebar />
          </div>
          <div className="min-[768px]:hidden"><WalletCard /></div>
        </div>

        <CenterPane />

        {/* Below 1200 px: a drawer. From 1200 px: the normal right pane. */}
        <div
          {...swipe}
          className={`flex flex-shrink-0 max-[1199px]:fixed max-[1199px]:inset-y-0 max-[1199px]:right-0 max-[1199px]:z-40 max-[1199px]:max-w-[calc(100vw-40px)] max-[1199px]:transition-[transform,visibility] max-[1199px]:duration-200 max-[1199px]:pt-[env(safe-area-inset-top)] max-[1199px]:pb-[env(safe-area-inset-bottom)] ${
            drawer === "agents" ? "" : "max-[1199px]:translate-x-full max-[1199px]:invisible"
          }`}
        >
          <AgentSidebar />
        </div>
      </div>

      {drawer !== "none" && (
        <div
          {...swipe}
          aria-hidden
          data-testid="drawer-backdrop"
          onClick={() => dispatch({ type: "close" })}
          className="fixed inset-0 z-30 min-[1200px]:hidden"
          style={{ background: "rgba(0,0,0,0.5)" }}
        />
      )}

      <StatusBar />

      {/* Daily-powered voice overlay — mounts on top of everything */}
      {activeVoiceChannelId && voiceChannel && (
        <VoiceRoom
          channelId={activeVoiceChannelId}
          channelName={voiceChannel.name}
          onClose={() => setActiveVoiceChannelId(null)}
        />
      )}
    </div>
  );
}
