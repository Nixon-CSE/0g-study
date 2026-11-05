/** Display a 0G balance: 3 decimals at 1 0G and above, 3 significant digits below. */
export function formatCredits(balance0G: number): string {
  return balance0G >= 1 ? balance0G.toFixed(3) : balance0G.toPrecision(3);
}
