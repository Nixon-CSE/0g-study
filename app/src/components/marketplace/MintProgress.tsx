'use client';

/**
 * Step indicator shown while the mint wizard moves through its async stages.
 * Rendered in place of the form once the user submits — replaced by the form
 * again on error (via parent state management).
 */

export type MintStep = 'preparing' | 'signing' | 'confirming' | 'done' | 'error';

interface Props {
  step: MintStep;
  error?: string | null;
}

const STEPS: { id: MintStep; label: string; description: string }[] = [
  {
    id: 'preparing',
    label: 'Preparing',
    description: 'Encrypting your agent bundle and uploading to 0G Storage…',
  },
  {
    id: 'signing',
    label: 'Sign transaction',
    description: 'Approve the mint transaction in your Privy wallet.',
  },
  {
    id: 'confirming',
    label: 'Confirming',
    description: 'Waiting for the 0G testnet to confirm your transaction…',
  },
  {
    id: 'done',
    label: 'Minted',
    description: 'Your agent INFT is live on 0G Chain.',
  },
];

const STEP_ORDER: MintStep[] = ['preparing', 'signing', 'confirming', 'done'];

export function MintProgress({ step, error }: Props) {
  const currentIndex = STEP_ORDER.indexOf(step === 'error' ? 'signing' : step);

  if (step === 'error') {
    return (
      <div className="flex flex-col items-center gap-4 py-6 px-2">
        {/* Error icon */}
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
          style={{ background: 'var(--bf-quaternary)', color: '#f87171' }}
          aria-hidden="true"
        >
          ✕
        </div>
        <p className="text-[var(--foreground)] font-semibold text-base">Mint failed</p>
        {error && (
          <p
            className="text-sm text-center max-w-xs rounded p-3"
            style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.12)' }}
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  if (step === 'done') {
    return (
      <div className="flex flex-col items-center gap-4 py-6 px-2">
        {/* Success icon */}
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
          style={{ background: 'rgba(52,211,153,0.15)', color: '#1f6b55' }}
          aria-hidden="true"
        >
          ✓
        </div>
        <p className="text-[var(--foreground)] font-semibold text-base">Agent minted!</p>
        <p className="text-sm" style={{ color: 'var(--bf-gray)' }}>
          Your agent INFT is live on 0G Chain.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* Progress bar */}
      <div className="flex gap-1.5">
        {STEP_ORDER.filter((s) => s !== 'done').map((s, i) => (
          <div
            key={s}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background:
                i < currentIndex
                  ? 'var(--bf-accent)'
                  : i === currentIndex
                    ? 'var(--bf-fire)'
                    : 'var(--bf-quinary)',
              opacity: i < currentIndex ? 0.6 : 1,
              transition: 'background 0.3s ease',
            }}
          />
        ))}
      </div>

      {/* Step list */}
      <ol className="flex flex-col gap-3">
        {STEPS.filter((s) => s.id !== 'done').map((s, i) => {
          const isDone = i < currentIndex;
          const isActive = i === currentIndex;

          return (
            <li key={s.id} className="flex items-start gap-3">
              {/* Status dot */}
              <div
                className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  background: isDone
                    ? 'rgba(52,211,153,0.2)'
                    : isActive
                      ? 'var(--bf-fire)'
                      : 'var(--bf-quaternary)',
                  color: isDone ? '#1f6b55' : '#fff',
                  border: isActive ? '2px solid var(--bf-fire)' : 'none',
                }}
              >
                {isDone ? '✓' : i + 1}
              </div>

              <div>
                <p
                  className="text-sm font-semibold"
                  style={{ color: isActive ? '#fff' : isDone ? '#1f6b55' : 'var(--bf-gray)' }}
                >
                  {s.label}
                  {isActive && (
                    <span
                      className="ml-2 inline-block animate-pulse text-xs font-normal"
                      style={{ color: 'var(--bf-fire)' }}
                    >
                      in progress…
                    </span>
                  )}
                </p>
                {isActive && (
                  <p className="text-xs mt-0.5" style={{ color: 'var(--bf-gray)' }}>
                    {s.description}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
