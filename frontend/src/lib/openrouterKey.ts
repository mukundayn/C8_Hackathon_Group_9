/** Browser-local bring-your-own OpenRouter key (never sent except to our API). */

const STORAGE_KEY = "netra_openrouter_api_key";

export function loadOpenRouterKey(): string {
  try {
    return (localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function saveOpenRouterKey(key: string): void {
  try {
    const cleaned = key.trim();
    if (cleaned) localStorage.setItem(STORAGE_KEY, cleaned);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearOpenRouterKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function maskOpenRouterKey(key: string): string {
  const k = key.trim();
  if (k.length < 12) return k ? "••••••••" : "";
  return `${k.slice(0, 6)}…${k.slice(-4)}`;
}

export function looksLikeOpenRouterKey(key: string): boolean {
  const k = key.trim();
  // OpenRouter keys are typically sk-or-v1-…; also accept sk- for flexibility.
  return k.length >= 20 && (k.startsWith("sk-or-") || k.startsWith("sk-"));
}
