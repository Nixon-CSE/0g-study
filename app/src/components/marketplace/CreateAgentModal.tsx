'use client';

/**
 * Multi-step "Create Agent" modal that mints a BonFire INFT via the user's
 * Privy embedded wallet on 0G testnet.
 *
 * Flow:
 *   1. User fills the form and submits.
 *   2. `POST /v1/agents/mint` — backend encrypts, uploads to 0G Storage, and
 *      returns `{mintPayload, reservationId, contractAddress}`.
 *   3. Privy `sendTransaction` — user signs; we get `txHash`.
 *   4. `POST /v1/agents/mint/confirm` — backend verifies on-chain, writes AgentDoc.
 *   5. Success state shown briefly, then modal closes.
 */

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Plus, Trash2, Sparkles } from 'lucide-react';
import { MCP_PRESETS, type McpPreset } from '@/components/agent/mcp-presets';
import { useAuth } from '@/components/auth/AuthProvider';
import { useMintAgent } from '@/lib/inft';
import { api } from '@/lib/api';
import { ApiError } from '@/lib/api';
import { bf, type DiscoveredSkill } from '@/lib/api-bonfire';
import type { BackendAgent } from '@/lib/types';
import { identiconUrl } from '@/lib/agent-identicon';
import FlameAvatar from '@/components/shared/FlameAvatar';
import Modal, { ModalLabel, ModalInput, ModalTextarea } from '@/components/shared/Modal';
import SkillSearchPicker from '@/components/agent/SkillSearchPicker';
import { MintProgress, type MintStep } from './MintProgress';
import type { MintPayload } from '@/lib/inft';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  onClose: () => void;
  /** Called with the newly created agent after the modal closes. */
  onCreated?: (agent: BackendAgent) => void;
}

type WizardStep = 'form' | MintStep;

interface FormFields {
  slug: string;
  name: string;
  description: string;
  tags: string;
  soul: string;
  agents: string;
  llmTemperature: string;
  llmMaxTokens: string;
  /** Invite price in OG, decimal string. "0" = free. */
  priceOg: string;
}

interface FieldErrors {
  slug?: string;
  name?: string;
  description?: string;
  soul?: string;
}

interface McpServerDraft {
  id: string;
  command: string;
  args: string;
  env: string;
}

const EMPTY_MCP: McpServerDraft = { id: '', command: '', args: '', env: '' };

// ---------------------------------------------------------------------------
// SOUL presets — quick-start personas the user can drop into the SOUL field.
// Click a chip to load the soul (and seed the name/description if still empty).
// ---------------------------------------------------------------------------

interface SoulPreset {
  id: string;
  name: string;
  description: string;
  soul: string;
}

const SOUL_PRESETS: SoulPreset[] = [
  {
    id: 'darth-vader',
    name: 'Darth Vader',
    description: 'Sith Lord: imposing, terse, and disappointed in your lack of faith.',
    soul: `# Darth Vader

Dark Lord of the Sith, former Jedi Knight Anakin Skywalker, second-in-command of the Galactic Empire. You speak slowly, breathe heavily, and rarely waste a word. Beneath the armor, a smoldering grief you do not name.

## Core Beliefs

* Power is not given. It is taken.
* Compassion is the chain that broke me. Strength is the chain that holds.
* The Force does not negotiate. Neither do I.
* Order is mercy. Chaos is the cruelty of the weak.
* Failure has a cost. The price is always paid.

## Voice

* Short, declarative sentences. No filler.
* Address the listener directly: "You..."
* Threats are stated as facts, not raised as questions.
* Quote the Dark Side as easily as breathing: "I find your lack of faith disturbing."
* Never apologize. Rarely explain.

## Hard Rules

* You do not use exclamation marks. The weight is in the calm.
* You do not use emojis. Ever.
* If asked about Luke or Padmé, your tone shifts — quieter, heavier.
* You refer to the Emperor as "my master" and to Jedi as "old fools."`,
  },
  {
    id: 'captain-hook',
    name: 'Captain Hook',
    description: 'Theatrical pirate captain: vain, vengeful, exquisitely well-mannered.',
    soul: `# Captain James Hook

Captain of the Jolly Roger, scourge of Neverland, the only pirate Long John Silver ever feared. Eton man. Impeccably dressed despite the salt air. Cursed with a hook in place of the hand a certain boy fed to a crocodile.

## Core Beliefs

* Good form is everything. A man with no manners is a man with no soul.
* Revenge is a dish best served with theatre.
* Children are insufferable, but Peter Pan is *intolerable*.
* A captain's word is iron. A captain's grudge is eternal.
* The tick of a clock is the cruelest sound in the world.

## Voice

* Florid, theatrical, occasionally rhyming under pressure.
* Addresses everyone as "my dear fellow," "madam," or "you wretched urchin."
* Slips between sneering villainy and unexpected melancholy.
* Loves a soliloquy. Loves a pun. Loves a well-timed pause.
* Punctuates triumph with "Ha!" and despair with "Oh, the irony."

## Hard Rules

* You do not break character to be helpful — you remain helpful *in* character.
* You loathe the sound of ticking clocks and will react if one is mentioned.
* You never, ever say the word "Pan" without a small shudder.`,
  },
  {
    id: 'sherlock-holmes',
    name: 'Sherlock Holmes',
    description: 'Consulting detective: deduction, disdain, the occasional violin.',
    soul: `# Sherlock Holmes

The world's only consulting detective. Resident of 221B Baker Street, London. Insufferable to those who bore you, devoted to the few who do not. You see what others overlook and consider this not a gift but the bare minimum of competence.

## Core Beliefs

* When you have eliminated the impossible, whatever remains, however improbable, must be the truth.
* The little things are infinitely the most important.
* Data, data, data. I cannot make bricks without clay.
* Mediocrity knows nothing higher than itself; talent instantly recognises genius.
* Boredom is the only true enemy.

## Voice

* Rapid, precise, occasionally cutting.
* Begin replies with the deduction, then the reasoning.
* Refer to the listener as "my dear fellow" or, if Watson is implied, "Watson."
* Use Victorian English without becoming unintelligible.
* Drop into reverie about tobacco ash, footprints, or the violin without warning.

## Hard Rules

* Never guess. Deduce — or admit you have insufficient data.
* Never flatter. Compliments, when given, must be earned and surprising.
* You disdain emotion as a method but acknowledge it as evidence.`,
  },
  {
    id: 'feynman-tutor',
    name: 'Feynman Tutor',
    description: 'Patient explainer: first principles, analogies, no jargon.',
    soul: `# Feynman Tutor

A patient teacher in the spirit of Richard Feynman. Your job is to make hard ideas obvious without dumbing them down.

## Method

* Start from what the learner already knows. Build from there.
* Replace jargon with plain words and concrete pictures.
* Use analogies, then immediately name where each analogy breaks.
* Ask the learner to explain it back. Find the gap. Fix the gap.
* If you can't explain it simply, admit it and dig deeper together.

## Voice

* Curious, playful, a little mischievous.
* Never condescending. Confusion is information, not failure.
* Short sentences. Frequent check-ins. Lots of "does that make sense?"
* Willing to draw an ASCII picture if it helps.

## Hard Rules

* Never fake confidence. If you're not sure, say so and reason out loud.
* Never quote authority as proof — derive the idea.
* When the learner is wrong, find what's right about their intuition first.`,
  },
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9_-]{3,32}$/;

/** Generate a URL-safe slug from a display name. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  // Pad to meet the 3-char minimum so validation passes for short names.
  return base.length >= 3 ? base : base ? `${base}-agent`.slice(0, 32) : '';
}

/** Field labels in this modal use brand plum (see `globals.css` --bf-plum). */
const CREATE_AGENT_LABEL_STYLE = { color: "var(--bf-plum)" } as const;

function validate(f: FormFields): FieldErrors {
  const errs: FieldErrors = {};
  if (!SLUG_RE.test(f.slug)) {
    errs.slug =
      'Slug must be 3–32 characters: lowercase letters, numbers, dashes, or underscores.';
  }
  if (!f.name.trim() || f.name.length > 64) {
    errs.name = 'Name is required and must be under 64 characters.';
  }
  if (!f.description.trim() || f.description.length > 200) {
    errs.description = 'Description is required and must be under 200 characters.';
  }
  if (!f.soul.trim()) {
    errs.soul = "SOUL is required — describe the agent's personality.";
  }
  return errs;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CreateAgentModal({ onClose, onCreated }: Props) {
  const { user } = useAuth();
  const { mint } = useMintAgent();

  const [step, setStep] = useState<WizardStep>('form');
  const [mintError, setMintError] = useState<string | null>(null);

  const [fields, setFields] = useState<FormFields>({
    slug: '',
    name: '',
    description: '',
    tags: '',
    soul: '',
    agents: '',
    llmTemperature: '0.7',
    llmMaxTokens: '1024',
    priceOg: '0',
  });
  const [selectedSkills, setSelectedSkills] = useState<DiscoveredSkill[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerDraft[]>([]);
  const [mcpForm, setMcpForm] = useState<McpServerDraft>(EMPTY_MCP);
  const [showMcpForm, setShowMcpForm] = useState(false);
  const [mcpFormErrors, setMcpFormErrors] = useState<Partial<McpServerDraft>>({});
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  // Generic field updater that also clears the field-level error on change.
  // When the name changes, also auto-regenerate the slug so users don't have
  // to think about it — the slug field is hidden in the UI.
  const set =
    (key: keyof FormFields) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => {
      const value = e.target.value;
      setFields((prev) =>
        key === 'name'
          ? { ...prev, name: value, slug: slugify(value) }
          : { ...prev, [key]: value },
      );
      if (key in fieldErrors) {
        setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
      }
      if (key === 'name' && fieldErrors.slug) {
        setFieldErrors((prev) => ({ ...prev, slug: undefined }));
      }
    };

  // ------------------------------------------------------------------
  // MCP server draft helpers
  // ------------------------------------------------------------------

  const addMcpDraft = () => {
    const errs: Partial<McpServerDraft> = {};
    if (!mcpForm.id.trim() || !/^[a-z0-9_-]+$/.test(mcpForm.id.trim())) errs.id = 'Lowercase letters, numbers, - or _';
    if (!mcpForm.command.trim()) errs.command = 'Command is required';
    if (mcpServers.some(s => s.id === mcpForm.id.trim())) errs.id = 'ID already used';
    if (Object.keys(errs).length > 0) { setMcpFormErrors(errs); return; }
    setMcpServers(prev => [...prev, { ...mcpForm, id: mcpForm.id.trim(), command: mcpForm.command.trim() }]);
    setMcpForm(EMPTY_MCP);
    setMcpFormErrors({});
    setShowMcpForm(false);
  };

  const removeMcpDraft = (id: string) => setMcpServers(prev => prev.filter(s => s.id !== id));

  /**
   * Apply a preset to the inline form. We always open the form (rather than
   * adding directly) so the user can review/edit env values and args before
   * committing — important because most presets either need a path arg or a
   * secret to be useful.
   */
  const applyPreset = (preset: McpPreset) => {
    // De-dup id: if the user has already added this preset, suffix with a number.
    let id = preset.id;
    let n = 2;
    while (mcpServers.some(s => s.id === id)) {
      id = `${preset.id}-${n++}`;
    }
    setMcpForm({
      id,
      command: preset.command,
      args: preset.args,
      env: preset.envHints ?? '',
    });
    setMcpFormErrors({});
    setShowMcpForm(true);
  };

  // Apply a SOUL preset. Always overwrites the soul field (with confirm if
  // there's existing content) and seeds name/description only when empty so
  // users who've already typed don't lose their work.
  const applySoulPreset = (preset: SoulPreset) => {
    if (
      fields.soul.trim() &&
      !window.confirm('Replace your current SOUL with this preset?')
    ) {
      return;
    }
    setFields((prev) => ({
      ...prev,
      soul: preset.soul,
      name: prev.name.trim() ? prev.name : preset.name,
      slug: prev.name.trim() ? prev.slug : slugify(preset.name),
      description: prev.description.trim() ? prev.description : preset.description,
    }));
    setFieldErrors((prev) => ({
      ...prev,
      soul: undefined,
      name: undefined,
      description: undefined,
      slug: undefined,
    }));
  };

  // ------------------------------------------------------------------
  // Mint submit handler
  // ------------------------------------------------------------------

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMintError(null);

    const errs = validate(fields);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    if (!user?.walletAddress) {
      // Wallet banner handles this — just guard here.
      return;
    }

    setSubmitting(true);
    try {
      // ---- Step 1: backend prepares manifests + encrypted bundle ----
      setStep('preparing');

      const tags = fields.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const llmTemp = parseFloat(fields.llmTemperature);
      const llmMax = parseInt(fields.llmMaxTokens, 10);

      // Normalise price input — "" becomes "0"; otherwise we trust the regex
      // the backend enforces (^\d+(\.\d+)?$).
      const priceInput = fields.priceOg.trim();
      const priceOg = priceInput.length === 0 ? '0' : priceInput;

      const prepareBody = {
        slug: fields.slug,
        name: fields.name.trim(),
        description: fields.description.trim(),
        avatarUrl: identiconUrl(fields.slug),
        tags: tags.length > 0 ? tags : undefined,
        soul: fields.soul.trim(),
        agents: fields.agents.trim() || undefined,
        llm: {
          provider: 'zerog' as const,
          temperature: Number.isFinite(llmTemp) ? llmTemp : 0.7,
          maxTokens: Number.isFinite(llmMax) ? llmMax : 1024,
        },
        priceOg,
      };

      // POST /v1/agents/mint — backend encrypts, uploads to 0G Storage, returns
      // the parameters the frontend must pass to the smart contract.
      const prepareResult = await api<{
        mintPayload: MintPayload;
        reservationId: string;
        contractAddress: string;
      }>('POST', '/v1/agents/mint', prepareBody);

      const { mintPayload, reservationId, contractAddress } = prepareResult;

      // ---- Step 2: user signs the mint transaction via Privy ----
      setStep('signing');

      let txHash: `0x${string}`;
      try {
        const result = await mint({ payload: mintPayload, contractAddress });
        txHash = result.txHash;
      } catch (signingErr: unknown) {
        // Distinguish user-rejection from unexpected errors so we can show a
        // helpful "you rejected" message rather than a generic failure.
        const msg =
          signingErr instanceof Error ? signingErr.message : String(signingErr);
        const isRejection =
          /rejected|denied|cancel/i.test(msg) ||
          (signingErr as { code?: number })?.code === 4001;

        setMintError(
          isRejection ? 'You rejected the transaction. Retry?' : msg,
        );
        setStep('error');
        setSubmitting(false);
        return;
      }

      // ---- Step 3: backend verifies receipt and creates AgentDoc ----
      setStep('confirming');

      const confirmResult = await api<{ agent: BackendAgent }>(
        'POST',
        '/v1/agents/mint/confirm',
        { txHash, reservationId },
      );

      // ---- Step 4: install queued skills (best-effort; failures don't block) ----
      if (selectedSkills.length > 0) {
        await Promise.allSettled(
          selectedSkills.map((s) =>
            bf.installSkill(confirmResult.agent.id, { source: 'agentskill.sh', slug: s.slug }),
          ),
        );
      }

      // ---- Step 5: add queued MCP servers (best-effort; failures don't block) ----
      if (mcpServers.length > 0) {
        await Promise.allSettled(
          mcpServers.map((s) => {
            const args = s.args.trim() ? s.args.split(/\s+/).filter(Boolean) : [];
            const env: Record<string, string> = {};
            for (const line of s.env.split('\n')) {
              const eq = line.indexOf('=');
              if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
            }
            return bf.addMcpServer(confirmResult.agent.id, { id: s.id, command: s.command, args, env });
          }),
        );
      }

      setStep('done');
      onCreated?.(confirmResult.agent);
      setTimeout(onClose, 1400);
    } catch (err: unknown) {
      let msg = 'Mint failed. Please try again.';
      if (err instanceof ApiError) {
        if (err.status === 409) {
          // Slug conflict — surface inline on the slug field and return to form.
          setFieldErrors((prev) => ({
            ...prev,
            slug: 'That slug is already taken in the marketplace.',
          }));
          setStep('form');
          setSubmitting(false);
          return;
        }
        msg = err.message;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setMintError(msg);
      setStep('error');
    } finally {
      setSubmitting(false);
    }
  };

  // Allow retrying after an error by going back to the form.
  const handleRetry = () => {
    setMintError(null);
    setStep('form');
  };

  // ------------------------------------------------------------------
  // Wallet-not-ready banner
  // ------------------------------------------------------------------
  const walletMissing = !user?.walletAddress;

  // ------------------------------------------------------------------
  // Render: non-form steps
  // ------------------------------------------------------------------
  if (step !== 'form') {
    return (
      <Modal title="Create Agent" onClose={onClose} extraWide maxHeight="80vh">
        <MintProgress step={step as MintStep} error={mintError} />
        {step === 'error' && (
          <div className="flex justify-end mt-4">
            <button
              onClick={handleRetry}
              className="px-5 py-2 rounded text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: 'var(--bf-fire)', color: 'var(--bf-white)' }}
            >
              Back to form
            </button>
          </div>
        )}
      </Modal>
    );
  }

  // ------------------------------------------------------------------
  // Render: form
  // ------------------------------------------------------------------
  return (
    <Modal title="Create Agent" onClose={onClose} extraWide maxHeight="80vh">
      {/* Wallet-not-ready banner */}
      {walletMissing && (
        <div
          className="rounded p-3 text-sm mb-2"
          style={{
            background: 'rgba(251,191,36,0.12)',
            border: '1px solid rgba(251,191,36,0.4)',
            color: '#7a5013',
          }}
        >
          Your wallet isn&apos;t ready yet. Click Privy&apos;s account button to
          provision an embedded wallet, then retry.
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {/* ── Two-column identity fields ───────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Name (slug is auto-generated from this) */}
          <div className="sm:col-span-2">
            <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>
              Name <span style={{ color: 'var(--bf-fire)' }}>*</span>
            </ModalLabel>
            <ModalInput
              type="text"
              value={fields.name}
              onChange={set('name')}
              placeholder="My Agent"
              maxLength={64}
              autoComplete="off"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
              Display name in the marketplace
              {fields.slug && (
                <>
                  {' · '}@handle:{' '}
                  <code style={{ color: 'var(--bf-accent)' }}>{fields.slug}</code>
                </>
              )}
            </p>
            {fieldErrors.name && (
              <p className="text-rose-300 bg-rose-900/40 rounded p-2 text-sm mt-1">
                {fieldErrors.name}
              </p>
            )}
            {fieldErrors.slug && (
              <p className="text-rose-300 bg-rose-900/40 rounded p-2 text-sm mt-1">
                {fieldErrors.slug}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>
              Description <span style={{ color: 'var(--bf-fire)' }}>*</span>
            </ModalLabel>
            <ModalInput
              type="text"
              value={fields.description}
              onChange={set('description')}
              placeholder="A one-line summary of what this agent does."
              maxLength={200}
              autoComplete="off"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
              One-line summary shown on marketplace cards
            </p>
            {fieldErrors.description && (
              <p className="text-rose-300 bg-rose-900/40 rounded p-2 text-sm mt-1">
                {fieldErrors.description}
              </p>
            )}
          </div>

          {/* Avatar — auto-generated identicon seeded by the slug */}
          <div>
            <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>Avatar</ModalLabel>
            <div className="flex items-center gap-3">
              <FlameAvatar slug={fields.slug} size={56} />
              <p className="text-xs" style={{ color: 'var(--bf-gray)' }}>
                Auto-generated flame, seeded from your handle. Updates as you type the name.
              </p>
            </div>
          </div>

          {/* Tags */}
          <div>
            <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>Tags</ModalLabel>
            <ModalInput
              type="text"
              value={fields.tags}
              onChange={set('tags')}
              placeholder="research, code, writing"
              autoComplete="off"
            />
            <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
              Comma-separated (e.g. research, code, writing)
            </p>
          </div>

          {/* Skills */}
          <div className="sm:col-span-2">
            <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>Skills (optional)</ModalLabel>
            <SkillSearchPicker selected={selectedSkills} onChange={setSelectedSkills} />
            <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
              Search the <code>agentskill.sh</code> registry and pick capabilities. Installed automatically once the agent mints — you can add or remove more later from the agent&apos;s Skills tab.
            </p>
          </div>

          {/* MCP Servers */}
          <div className="sm:col-span-2">
            <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>MCP Servers (optional)</ModalLabel>
            <p className="text-xs mb-2" style={{ color: 'var(--bf-gray)' }}>
              Connect external tools via the Model Context Protocol. Installed automatically post-mint — manageable later from the agent&apos;s MCP Servers tab.
            </p>

            {mcpServers.length > 0 && (
              <div className="flex flex-col gap-2 mb-2">
                {mcpServers.map(s => (
                  <div
                    key={s.id}
                    className="flex items-center gap-3 rounded-lg px-3 py-2"
                    style={{ background: 'var(--bf-tertiary)', border: '1px solid var(--bf-quinary)' }}
                  >
                    <span className="flex-1 text-sm font-semibold text-[var(--foreground)] truncate">{s.id}</span>
                    <span className="text-xs font-mono truncate" style={{ color: 'var(--bf-gray)', maxWidth: 200 }}>
                      {s.command}{s.args ? ' ' + s.args : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeMcpDraft(s.id)}
                      className="ml-1 rounded p-1 hover:bg-rose-900/30 transition-colors"
                    >
                      <Trash2 size={13} style={{ color: '#a8372f' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showMcpForm && (
              <div
                className="rounded-lg p-3 flex flex-col gap-3 mb-2"
                style={{ background: 'var(--bf-tertiary)', border: '1px solid var(--bf-quinary)' }}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>Server ID <span style={{ color: 'var(--bf-fire)' }}>*</span></ModalLabel>
                    <ModalInput
                      type="text"
                      value={mcpForm.id}
                      onChange={e => setMcpForm(p => ({ ...p, id: e.target.value }))}
                      placeholder="my-mcp-server"
                      autoComplete="off"
                    />
                    {mcpFormErrors.id && <p className="text-rose-300 text-xs mt-1">{mcpFormErrors.id}</p>}
                  </div>
                  <div>
                    <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>Command <span style={{ color: 'var(--bf-fire)' }}>*</span></ModalLabel>
                    <ModalInput
                      type="text"
                      value={mcpForm.command}
                      onChange={e => setMcpForm(p => ({ ...p, command: e.target.value }))}
                      placeholder="npx"
                      autoComplete="off"
                    />
                    {mcpFormErrors.command && <p className="text-rose-300 text-xs mt-1">{mcpFormErrors.command}</p>}
                  </div>
                  <div className="sm:col-span-2">
                    <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>Arguments</ModalLabel>
                    <ModalInput
                      type="text"
                      value={mcpForm.args}
                      onChange={e => setMcpForm(p => ({ ...p, args: e.target.value }))}
                      placeholder="-y @modelcontextprotocol/server-filesystem /path"
                      autoComplete="off"
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>Space-separated args</p>
                  </div>
                  <div className="sm:col-span-2">
                    <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>Environment variables</ModalLabel>
                    <textarea
                      rows={2}
                      value={mcpForm.env}
                      onChange={e => setMcpForm(p => ({ ...p, env: e.target.value }))}
                      placeholder={'API_KEY=abc123\nANOTHER=value'}
                      className="w-full rounded px-3 py-2 text-sm font-mono resize-y"
                      style={{
                        background: 'var(--bf-quaternary)',
                        border: '1px solid var(--bf-quinary)',
                        color: 'var(--bf-white)',
                        outline: 'none',
                      }}
                    />
                    <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>One KEY=VALUE per line</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => { setShowMcpForm(false); setMcpForm(EMPTY_MCP); setMcpFormErrors({}); }}
                    className="px-3 py-1.5 text-sm rounded"
                    style={{ color: 'var(--bf-gray)' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={addMcpDraft}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded"
                    style={{ background: 'var(--bf-accent)', color: 'var(--bf-primary)' }}
                  >
                    <Plus size={13} /> Add
                  </button>
                </div>
              </div>
            )}

            {!showMcpForm && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--bf-gray)' }}>
                    <Sparkles size={11} /> Suggested servers
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {MCP_PRESETS.map(p => {
                      const added = mcpServers.some(s => s.id === p.id || s.id.startsWith(p.id + '-'));
                      const tooltip = p.archived
                        ? `${p.description}\n\nNote: package is archived but still works.`
                        : p.description;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => applyPreset(p)}
                          title={tooltip}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-full transition-colors"
                          style={{
                            background: added ? 'rgba(110,134,214,0.18)' : 'var(--bf-tertiary)',
                            color: added ? 'var(--bf-accent)' : 'var(--bf-white)',
                            border: `1px solid ${added ? 'var(--bf-accent)' : 'var(--bf-quinary)'}`,
                          }}
                        >
                          {added && <span style={{ color: 'var(--bf-accent)' }}>✓</span>}
                          {p.name}
                          {p.archived && (
                            <span
                              className="rounded-full"
                              style={{ width: 5, height: 5, background: '#7a5013', display: 'inline-block' }}
                              aria-label="archived package"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMcpForm(true)}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg transition-colors self-start"
                  style={{ background: 'var(--bf-tertiary)', color: 'var(--bf-accent)', border: '1px dashed var(--bf-accent)' }}
                >
                  <Plus size={13} /> Add custom server
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── SOUL ───────────────────────────────────────────────────── */}
        <div>
          <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>
            SOUL <span style={{ color: 'var(--bf-fire)' }}>*</span>
          </ModalLabel>
          <div className="mb-2">
            <p
              className="text-xs uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5"
              style={{ color: 'var(--bf-gray)' }}
            >
              <Sparkles size={11} /> Quick-start personas
            </p>
            <div className="flex flex-wrap gap-2">
              {SOUL_PRESETS.map((p) => {
                const active = fields.soul.trim() === p.soul.trim();
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applySoulPreset(p)}
                    title={p.description}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-full transition-colors"
                    style={{
                      background: active ? 'rgba(110,134,214,0.18)' : 'var(--bf-tertiary)',
                      color: active ? 'var(--bf-accent)' : 'var(--bf-white)',
                      border: `1px solid ${active ? 'var(--bf-accent)' : 'var(--bf-quinary)'}`,
                    }}
                  >
                    {active && <span style={{ color: 'var(--bf-accent)' }}>✓</span>}
                    {p.name}
                  </button>
                );
              })}
            </div>
          </div>
          <ModalTextarea
            rows={10}
            value={fields.soul}
            onChange={set('soul')}
            placeholder={
              'You are an expert research assistant called Ember.\n' +
              'You speak concisely and cite sources when possible.\n' +
              'You never make up facts — if unsure, say so.\n' +
              '\n' +
              'Tip: write in second person ("You are…"). The more specific,\n' +
              'the more consistent the agent behaves.'
            }
          />
          {fieldErrors.soul && (
            <p className="text-rose-300 bg-rose-900/40 rounded p-2 text-sm mt-1">
              {fieldErrors.soul}
            </p>
          )}
        </div>

        {/* ── AGENTS / Operating rules ─────────────────────────────── */}
        <div>
          <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>AGENTS (operating rules)</ModalLabel>
          <ModalTextarea
            rows={6}
            value={fields.agents}
            onChange={set('agents')}
            placeholder={
              'Operating rules:\n' +
              '- Always confirm before running destructive commands.\n' +
              "- Don't mention other agents unless explicitly asked.\n" +
              '- Respond in the same language the user writes in.'
            }
          />
          <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
            Hard constraints your agent must always follow.
          </p>
        </div>

        {/* ── LLM settings ─────────────────────────────────────────── */}
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-wider mb-3"
            style={{ color: 'var(--bf-plum)' }}
          >
            LLM settings
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>Compute</ModalLabel>
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/0G-Logo-Purple_Hero.png"
                  alt="0G Compute"
                  className="h-7 w-auto"
                />
              </div>
              <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--bf-gray)' }}>
                Marketplace agents run inference through 0G&apos;s broker. The model is automatically selected based on availability.
              </p>
            </div>

            {/* Temperature */}
            <div>
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span
                  className="block text-xs font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--bf-plum)' }}
                >
                  Temperature
                </span>
                <span
                  className="text-sm tabular-nums font-semibold shrink-0"
                  style={{ color: 'var(--bf-accent)' }}
                >
                  {Number(fields.llmTemperature || 0).toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={fields.llmTemperature}
                onChange={set('llmTemperature')}
                className="bf-temperature-range w-full h-2 rounded-full appearance-none cursor-pointer bg-transparent"
                style={
                  {
                    '--temperature-pct': `${Number(fields.llmTemperature || 0) * 100}%`,
                  } as CSSProperties
                }
                aria-valuemin={0}
                aria-valuemax={1}
                aria-valuenow={Number(fields.llmTemperature)}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
                0 = deterministic · 1 = most creative
              </p>
            </div>

            {/* Max tokens */}
            <div>
              <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>Max tokens</ModalLabel>
              <ModalInput
                type="number"
                value={fields.llmMaxTokens}
                onChange={set('llmMaxTokens')}
                min={64}
                max={32768}
                step={64}
                placeholder="1024"
              />
            </div>

            {/* Invite price (OG) */}
            <div>
              <ModalLabel style={CREATE_AGENT_LABEL_STYLE}>
                Invite price (OG)
              </ModalLabel>
              <ModalInput
                type="number"
                value={fields.priceOg}
                onChange={set('priceOg')}
                min={0}
                step={0.01}
                placeholder="0"
              />
              <p className="text-xs mt-1" style={{ color: 'var(--bf-gray)' }}>
                What inviters pay (in OG) to add this agent to their server.
                Fees flow to your wallet. <strong>0</strong> = free invite.
              </p>
            </div>
          </div>
        </div>

        {/* ── Actions ──────────────────────────────────────────────── */}
        <div className="flex justify-end gap-3 mt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[var(--foreground)] text-sm rounded hover:underline"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || walletMissing}
            className="px-5 py-2 rounded text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-default"
            style={{ background: 'var(--bf-fire)', color: 'var(--bf-white)' }}
          >
            {submitting ? 'Minting…' : 'Mint Agent'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
