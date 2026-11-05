"use client";
import { useCallback, useRef, useState } from "react";
import type { AgentToastItem } from "@/components/shared/AgentToast";

let _seq = 0;
const nextId = () => `n-${++_seq}`;

const LS_KEY = "bonfire_notifications_enabled";

function notificationsEnabled(): boolean {
  try { return localStorage.getItem(LS_KEY) !== "false"; } catch { return true; }
}

export function useAgentNotifications() {
  const [toasts, setToasts] = useState<AgentToastItem[]>([]);
  const permRef = useRef<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      const p = await Notification.requestPermission();
      permRef.current = p;
    }
  }, []);

  const push = useCallback((item: Omit<AgentToastItem, "id">) => {
    if (!notificationsEnabled()) return;

    const id = nextId();

    // Browser notification when tab is hidden
    if (
      typeof document !== "undefined" &&
      document.hidden &&
      permRef.current === "granted"
    ) {
      const title = item.isTask
        ? `${item.agentName} completed a task`
        : item.agentName;
      const body = item.message.slice(0, 100);
      new Notification(title, { body, icon: item.agentAvatar });
      return; // don't also show in-app toast when tab is hidden
    }

    // In-app toast
    setToasts(prev => [...prev.slice(-4), { ...item, id }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, push, dismiss, requestPermission };
}
