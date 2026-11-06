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
