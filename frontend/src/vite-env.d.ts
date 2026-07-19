/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Injected via vite.config.ts `define` from the CLERK_PUBLISHABLE_KEY env var. */
  readonly CLERK_PUBLISHABLE_KEY: string;
  /** API base URL. "" (same-origin) in prod; dev uses the Vite proxy. */
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
