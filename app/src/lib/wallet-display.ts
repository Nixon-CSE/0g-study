/** Below this OG balance the server wallet offers funding and omits the tier pill (no "Low" label). */
export const LOW_BALANCE_THRESHOLD_OG = 0.1;

/** An empty server wallet is a normal state: Study Pod doesn't use it, so it's never shown as an error. */
export const WALLET_OPTIONAL_COPY = "Optional: fund this server's wallet for on-chain features";

export function isLowBalance(bal: number | null): boolean {
  return bal !== null && bal < LOW_BALANCE_THRESHOLD_OG;
}
