// Claude-style cool fallback names when the user hasn't told us what to call them.
const COOL_FALLBACKS = [
  "friend", "explorer", "wanderer", "trailblazer", "stargazer",
  "kindred spirit", "fellow traveler", "curious one", "night owl", "firekeeper",
];

export function isPrivyDid(s: string | undefined): boolean {
  return !!s && s.startsWith("did:");
}

export function resolveGreetingName(preferred: string, username: string): string {
  if (preferred.trim()) return preferred.trim();
  if (username && !isPrivyDid(username) && username !== "You") return username;
  const idx = Math.floor((typeof window !== "undefined" ? performance.timeOrigin : 0) % COOL_FALLBACKS.length);
  return COOL_FALLBACKS[idx] ?? "friend";
}

export function greetingUsesFallback(preferredName: string, username: string): boolean {
  return !preferredName.trim() && (isPrivyDid(username) || username === "You");
}
