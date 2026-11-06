import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { LOW_BALANCE_THRESHOLD_OG, WALLET_OPTIONAL_COPY, isLowBalance } from "../wallet-display";

const read = (f: string) => fs.readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), "utf8");

describe("composer", () => {
  it("shows no invented per-message cost", () => {
    const src = read("components/message/MessageComposer.tsx");
    expect(src).not.toMatch(/estimatedCost|0\.00015/);
  });
});

describe("server wallet", () => {
  it("an empty wallet is a normal state, not an error", () => {
    expect(isLowBalance(0)).toBe(true);
    expect(isLowBalance(LOW_BALANCE_THRESHOLD_OG)).toBe(false);
    expect(isLowBalance(null)).toBe(false);
    expect(WALLET_OPTIONAL_COPY).toBe("Optional: fund this server's wallet for on-chain features");
    const src = read("components/server/WalletPanel.tsx");
    expect(src).not.toContain("--negative");
    expect(src).toContain("WALLET_OPTIONAL_COPY");
  });
});

describe("status bar stays on one line", () => {
  const bar = read("components/layout/StatusBar.tsx");
  const acct = read("components/layout/ZeroGAccount.tsx");
  it("never wraps, and hides low-priority items below ~1100 px", () => {
    expect(bar).toContain("whitespace-nowrap");
    expect(bar.match(/hidden min-\[1100px\]:flex/g)).toHaveLength(2); // network label, wallet address
  });
  it("calls, streak and credits never shrink", () => {
    expect(bar).toMatch(/className="flex-shrink-0"[^\n]*usage today/);
    expect(bar).toMatch(/className="flex-shrink-0"[^\n]*study streak/);
    expect(acct).toMatch(/flex items-center gap-1\.5 relative flex-shrink-0/);
  });
  it("disconnect stays reachable when the inline link is hidden", () => {
    expect(acct).toContain(">Disconnect</button>");
  });
  it("no clipping container around the upward popovers", () => {
    expect(bar).not.toMatch(/className="[^"]*overflow-hidden/);
  });
});

describe("PWA", () => {
  const manifest = JSON.parse(fs.readFileSync(fileURLToPath(new URL("../../../public/site.webmanifest", import.meta.url)), "utf8"));
  it("is a complete manifest with a maskable icon", () => {
    expect(manifest).toMatchObject({ name: "0G Study", short_name: "0G Study", start_url: "/workspace", display: "standalone", theme_color: "#e9e9e6", background_color: "#e9e9e6" });
    expect(manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
    for (const i of manifest.icons) expect(fs.existsSync(fileURLToPath(new URL(`../../../public${i.src}`, import.meta.url))), i.src).toBe(true);
  });
  it("nothing can cache API calls: there is no service worker", () => {
    expect(fs.existsSync(fileURLToPath(new URL("../../../public/sw.js", import.meta.url)))).toBe(false);
    expect(read("app/layout.tsx")).not.toContain("serviceWorker");
  });
});

describe("phones", () => {
  it("a phone gets the camera and the library; the shell has drawers and honours the notch", () => {
    const composer = read("components/message/MessageComposer.tsx");
    expect(composer).toContain('capture="environment"');
    expect(composer).toContain("Take photo");
    expect(composer).toContain("Choose from library");
    expect(read("app/layout.tsx")).toContain('viewportFit: "cover"');
    expect(read("app/globals.css")).toContain("100dvh");
    expect(read("components/layout/AppShell.tsx")).toContain("--keyboard-inset");
  });
  it("modals are portalled, so a drawer's transform can't trap them", () => {
    expect(read("components/shared/Modal.tsx")).toContain("createPortal(");
  });
});
