"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Avatar from "@/components/shared/BoringAvatar";
import { useApp } from "@/context/AppContext";
import Modal, { ModalLabel, ModalInput } from "@/components/shared/Modal";
import WalletFundingModal from "@/components/server/WalletFundingModal";
import type { BackendServerWallet, BackendServerFunding } from "@/lib/types";
import { BF_BRAND_EMOJI } from "@/lib/brand";
import { useFundServerWallet } from "@/lib/server-wallet";

const SERVER_COLORS = ["#7a5013", "var(--bf-fire)", "var(--bf-accent)", "#a8372f", "#7a5013", "#5b3d8c", "#00d8ff", "#ed1b24"];

interface FundingState {
  wallet: BackendServerWallet;
  funding: BackendServerFunding;
  serverName: string;
}

function SolidPlusIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0" fill="currentColor">
      <path d="M12 5a1 1 0 0 1 1 1v4h4a1 1 0 1 1 0 2h-4v4a1 1 0 1 1-2 0v-4H7a1 1 0 1 1 0-2h4V6a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function SolidCompassIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0" fill="currentColor">
      <path
        fillRule="evenodd"
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c3.87 0 7 3.13 7 7s-3.13 7-7 7-7-3.13-7-7 3.13-7 7-7z"
      />
      <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
    </svg>
  );
}

export default function LeftNav() {
  const { servers, activeServerId, setActiveServer, createServer } = useApp();
  const { fund } = useFundServerWallet();
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(SERVER_COLORS[0]);
  const [desc, setDesc] = useState("");
  const [initialFund, setInitialFund] = useState("4");
  const [creating, setCreating] = useState(false);
  const [fundingError, setFundingError] = useState<string | null>(null);
  const [fundingState, setFundingState] = useState<FundingState | null>(null);

  useEffect(() => {
    const open = () => setShowModal(true);
    window.addEventListener("bonfire:open-create-server", open);
    return () => window.removeEventListener("bonfire:open-create-server", open);
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    const serverName = name.trim();
    const fundAmount = initialFund.trim();
    // Validate fund amount before creating the server so a typo doesn't leave
    // us with an empty workspace + a confusing error.
    if (fundAmount && !/^\d+(\.\d+)?$/.test(fundAmount)) {
      setFundingError("Initial fund must be a number (or empty to skip).");
      return;
    }
    setCreating(true);
    setFundingError(null);
    try {
      const result = await createServer(serverName, color, desc.trim());
      // Reset form fields only after the server creation succeeds.
      setName(""); setDesc(""); setColor(SERVER_COLORS[0]); setInitialFund("4");
      setShowModal(false);
      if (result.wallet && result.funding) {
        setFundingState({ wallet: result.wallet, funding: result.funding, serverName });
        if (fundAmount && Number(fundAmount) > 0) {
          // Fire-and-forget Privy signing — failure here just means the user
          // declined or had insufficient funds; the WalletFundingModal still
          // shows the address + faucet link as a fallback.
          try {
            await fund({ toAddress: result.wallet.address, amountOg: fundAmount });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setFundingError(`Initial fund failed: ${msg}. You can fund manually from the wallet panel.`);
          }
        }
      }
    } catch {
      // createServer already surfaces the error via AppContext's error state
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      <nav
        className="w-[72px] flex flex-col items-center py-3 gap-2 overflow-y-auto flex-shrink-0"
        style={{ background: "var(--bf-tertiary)" }}
      >
        {/* BonFire home logo */}
        <div className="relative flex items-center flex-shrink-0 group" style={{ width: 72, height: 48 }}>
          <div
            className="pointer-events-none absolute left-full ml-4 px-3 py-1.5 rounded-md text-sm font-semibold text-[var(--on-ink)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl"
            style={{ background: "var(--ink)" }}
          >
            <span
              className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-0 h-0"
              style={{ borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderRight: "6px solid var(--ink)" }}
            />
            BonFire
          </div>
          <button
            onClick={() => router.push("/marketplace")}
            title="BonFire Marketplace"
            className="mx-auto flex bg-lime-950 items-center justify-center transition-all duration-150 overflow-hidden text-[1.75rem] leading-none select-none"
            style={{ width: 48, height: 48, borderRadius: "30%" }}
          >
            <span role="img" aria-label="BonFire">{BF_BRAND_EMOJI}</span>
          </button>
        </div>

        {/* Separator below logo */}
        <div className="w-8 border-b" style={{ borderColor: "var(--bf-quinary)" }} />

        {servers.map(srv => (
          <ServerPill
            key={srv.id}
            name={srv.name}
            color={srv.color}
            icon={srv.icon}
            active={activeServerId === srv.id}
            onClick={() => { setActiveServer(srv.id); router.push("/workspace"); }}
          />
        ))}

        {/* Between server list and Add/Discover — skip when empty so we don’t stack two lines under the logo */}
        {servers.length > 0 && (
          <div className="w-8 border-b" style={{ borderColor: "var(--bf-quinary)" }} />
        )}

        {/* Add server */}
        <NavPill
          title="Add a Server"
          onClick={() => setShowModal(true)}
          accentColor="var(--bf-plum)"
          iconColor="var(--on-ink)"
        >
          <SolidPlusIcon size={24} />
        </NavPill>

        {/* Discover */}
        <NavPill
          title="Discover Servers"
          accentColor="var(--bf-plum)"
          iconColor="var(--on-ink)"
          onClick={() => router.push("/marketplace")}
        >
          <SolidCompassIcon size={22} />
        </NavPill>
      </nav>

      {fundingState && (
        <WalletFundingModal
          wallet={fundingState.wallet}
          funding={fundingState.funding}
          serverName={fundingState.serverName}
          onClose={() => setFundingState(null)}
        />
      )}

      {showModal && (
        <Modal
          title="Create a Server"
          subtitle="Give your agent workspace a name and colour."
          onClose={() => setShowModal(false)}
          onConfirm={handleCreate}
          confirmDisabled={!name.trim() || creating}
          confirmLabel={creating ? "Creating…" : "Create Server"}
        >
          <div>
            <ModalLabel>Server Name</ModalLabel>
            <ModalInput
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="My Research Lab"
              onKeyDown={e => { if (e.key === "Enter") void handleCreate(); }}
            />
          </div>
          <div>
            <ModalLabel>Description (optional)</ModalLabel>
            <ModalInput
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="What does this server do?"
            />
          </div>
          <div>
            <ModalLabel>Initial fund (OG)</ModalLabel>
            <ModalInput
              value={initialFund}
              onChange={e => setInitialFund(e.target.value)}
              placeholder="4"
            />
            <p className="text-xs mt-1" style={{ color: "var(--bf-symbol)" }}>
              Sent from your wallet to the server&apos;s wallet on creation. Min 4 OG recommended (3 OG ledger minimum + gas). Leave blank to fund later.
            </p>
            {fundingError && (
              <p className="text-xs mt-1" style={{ color: "#a8372f" }}>{fundingError}</p>
            )}
          </div>
          <div>
            <ModalLabel>Colour</ModalLabel>
            <div className="flex gap-2 flex-wrap">
              {SERVER_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    background: c,
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    border: color === c ? "3px solid white" : "3px solid transparent",
                    transition: "transform 0.1s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1.15)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
                />
              ))}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function ServerPill({
  name, color, icon, active, onClick,
}: {
  name: string; color: string; icon?: string; active: boolean; onClick: () => void;
}) {
  return (
    <div className="relative flex items-center flex-shrink-0 group" style={{ width: 72, height: 48 }}>
      {/* Tooltip */}
      <div
        className="pointer-events-none absolute left-full ml-4 px-3 py-1.5 rounded-md text-sm font-semibold text-[var(--on-ink)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl"
        style={{ background: "var(--ink)" }}
      >
        <span
          className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-0 h-0"
          style={{ borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderRight: "6px solid var(--ink)" }}
        />
        {name}
      </div>

      {/* Active indicator pill */}
      <span
        className="absolute left-0 rounded-r-full bg-[var(--ink)] transition-all duration-200"
        style={{
          width: 4,
          height: active ? 36 : 8,
          top: "50%",
          transform: "translateY(-50%)",
          opacity: active ? 1 : 0,
        }}
      />

      <button
        onClick={onClick}
        title={name}
        className="mx-auto flex items-center justify-center font-bold text-[var(--foreground)] transition-all duration-150 overflow-hidden"
        style={{
          width: 48,
          height: 48,
          borderRadius: active ? "30%" : "50%",
          background: icon ? color : "transparent",
        }}
        onMouseEnter={e => {
          if (!active) (e.currentTarget as HTMLElement).style.borderRadius = "30%";
        }}
        onMouseLeave={e => {
          if (!active) (e.currentTarget as HTMLElement).style.borderRadius = "50%";
        }}
      >
        {icon
          ? <img src={icon} alt={name} className="w-7 h-7 object-cover" />
          : <Avatar
            name={name}
            size={48}
            variant="bauhaus"
            colors={["#7a5013", "#7a5013", "#ed1b24", "#5b3d8c", "#00d8ff"]}
            square
          />
        }
      </button>
    </div>
  );
}

function NavPill({
  children, title, onClick, accentColor,
  iconColor = "var(--on-ink)",
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  accentColor: string;
  /** Fill for icons using currentColor (default white on accent backgrounds). */
  iconColor?: string;
}) {
  return (
    <div className="relative flex items-center flex-shrink-0 group" style={{ width: 72, height: 48 }}>
      {/* Tooltip */}
      <div
        className="pointer-events-none absolute left-full ml-4 px-3 py-1.5 rounded-md text-sm font-semibold text-[var(--on-ink)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-50 shadow-xl"
        style={{ background: "var(--ink)" }}
      >
        <span
          className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-0 h-0"
          style={{ borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderRight: "6px solid var(--ink)" }}
        />
        {title}
      </div>

      <button
        onClick={onClick}
        title={title}
        className="mx-auto flex items-center justify-center transition-all duration-150 flex-shrink-0 hover:ring-2 hover:ring-[var(--bf-border)]"
        style={{
          width: 48,
          height: 48,
          borderRadius: "30%",
          background: accentColor,
          color: iconColor,
        }}
      >
        {children}
      </button>
    </div>
  );
}
