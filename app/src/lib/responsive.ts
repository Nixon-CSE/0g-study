/**
 * Workspace layout rules. Phones show one pane at a time, tablets add the channels, and desktop keeps
 * all three. The CSS uses the same numbers (max-[767px], min-[1200px]); this file decides which drawer
 * may be open, so the logic can be tested without a browser.
 */
export const PHONE_MAX_WIDTH = 767;
export const DESKTOP_MIN_WIDTH = 1200;

export type Layout = "phone" | "tablet" | "desktop";
export type Drawer = "none" | "nav" | "agents";
export type DrawerAction =
  | { type: "toggle"; drawer: Exclude<Drawer, "none"> }
  | { type: "close" }
  | { type: "resize"; width: number };

export function layoutFor(width: number): Layout {
  if (width <= PHONE_MAX_WIDTH) return "phone";
  return width < DESKTOP_MIN_WIDTH ? "tablet" : "desktop";
}

/** Whether a drawer exists at this layout. Anything else is already on screen as a normal pane. */
export function isDrawer(drawer: Exclude<Drawer, "none">, layout: Layout): boolean {
  if (layout === "desktop") return false;
  return drawer === "agents" || layout === "phone";
}

export function drawerReducer(state: Drawer, action: DrawerAction): Drawer {
  switch (action.type) {
    case "toggle": return state === action.drawer ? "none" : action.drawer;
    case "close": return "none";
    case "resize": return state !== "none" && !isDrawer(state, layoutFor(action.width)) ? "none" : state;
  }
}

/** A swipe closes a drawer towards the edge it came from, if mostly sideways and at least 60 px. */
export function isCloseSwipe(drawer: Drawer, dx: number, dy: number): boolean {
  if (drawer === "none" || Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return false;
  return drawer === "nav" ? dx < 0 : dx > 0;
}

/** How much of the layout viewport the on-screen keyboard covers. iOS doesn't resize the layout for it. */
export function keyboardInset(layoutHeight: number, viewport: { height: number; offsetTop: number }): number {
  return Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
}

/** What to tell a student whose photo the browser can't decode (HEIC outside Safari, mostly). */
export function photoDecodeError(file: { name?: string; type?: string }): string {
  const heic = /hei[cf]/i.test(file.type ?? "") || /\.hei[cf]$/i.test(file.name ?? "");
  return heic
    ? "This browser can't read HEIC photos. Please use a JPEG (on iPhone: Settings → Camera → Formats → Most Compatible)."
    : "Couldn't read that image. Please try a JPEG or PNG.";
}
