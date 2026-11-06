"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentToastItem } from "@/components/shared/AgentToast";
import { enqueueToast, notifyDecision, toastPreview } from "@/lib/agent-toast-policy";

let _seq = 0;
const nextId = () => `n-${++_seq}`;

const LS_KEY = "bonfire_notifications_enabled";

function notificationsEnabled(): boolean {
  try { return localStorage.getItem(LS_KEY) !== "false"; } catch { return true; }
}

export interface AgentNotification extends Omit<AgentToastItem, "id"> {
  /** Channel the reply landed in; replies in the channel on screen are not toasted. */
  channelId?: string | null;
}

/**
 * @param getViewingChannelId returns the channel currently on screen (read at push time, so a ref
 *        getter is fine and keeps `push` stable).
 */
export function useAgentNotifications(getViewingChannelId: () => string | null | undefined = () => null) {
  const [toasts, setToasts] = useState<AgentToastItem[]>([]);
  const viewingRef = useRef(getViewingChannelId);
  useEffect(() => { viewingRef.current = getViewingChannelId; }, [getViewingChannelId]);
  const permRef = useRef<NotificationPermission | "unsupported">(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      permRef.current = await Notification.requestPermission();
    }
  }, []);

  const push = useCallback(({ channelId, ...item }: AgentNotification) => {
    if (!notificationsEnabled()) return;
    const message = toastPreview(item.message);
    const decision = notifyDecision({
      replyChannelId: channelId,
      viewingChannelId: viewingRef.current(),
      documentHidden: typeof document !== "undefined" && document.hidden,
      systemPermission: permRef.current,
    });
    if (decision === "none") return;
    if (decision === "system") {
      try {
        new Notification(item.isTask ? `${item.agentName} completed a task` : item.agentName, {
          body: message,
          icon: item.agentAvatar,
        });
      } catch { /* some browsers throw outside a service worker; a missed OS notification is fine */ }
      return;
    }
    setToasts((prev) => enqueueToast(prev, { ...item, message, id: nextId() }));
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, push, dismiss, requestPermission };
}
