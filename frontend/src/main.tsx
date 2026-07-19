import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import "./styles/index.css";
import AppRouter from "./AppRouter.tsx";

const publishableKey = (import.meta.env.CLERK_PUBLISHABLE_KEY || "").trim();
const isPlaceholder =
  !publishableKey ||
  publishableKey === "pk_test_your_clerk_publishable_key" ||
  publishableKey.includes("your_clerk");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found in DOM");

if (isPlaceholder) {
  const seen = publishableKey
    ? `${publishableKey.slice(0, 12)}… (len ${publishableKey.length})`
    : "(empty — Vite did not load any CLERK_PUBLISHABLE_KEY)";
  // Visible fallback — invalid Clerk keys leave an infinite cyan spinner.
  rootEl.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
      background:#060814;color:#e2e8f0;font-family:ui-monospace,monospace;padding:2rem;text-align:left">
      <div style="max-width:40rem">
        <div style="color:#22d3ee;font-size:12px;letter-spacing:.12em;margin-bottom:8px">NETRA.AI</div>
        <h1 style="font-size:18px;margin:0 0 12px">Clerk key not configured</h1>
        <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 12px">
          Vite currently sees: <code style="color:#fbbf24">${seen}</code>
        </p>
        <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 12px">
          This screen is <strong>only</strong> about <code style="color:#67e8f8">CLERK_PUBLISHABLE_KEY</code>
          in <code style="color:#67e8f8">frontend/.env</code>. The expertise multi-select on the login
          page is unrelated — it cannot cause this error.
        </p>
        <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:0 0 8px">Fix checklist:</p>
        <ol style="color:#94a3b8;font-size:13px;line-height:1.6;margin:0 0 12px;padding-left:1.2rem">
          <li>Edit <code style="color:#67e8f8">frontend/.env</code> (not backend/.env, not .env.example)</li>
          <li>One line, no quotes, no spaces around <code>=</code>:</li>
        </ol>
        <pre style="background:#0f172a;border:1px solid #334155;padding:12px;border-radius:8px;
          color:#f8fafc;font-size:12px;overflow:auto">CLERK_PUBLISHABLE_KEY=pk_test_xxxxxxxx</pre>
        <p style="color:#94a3b8;font-size:13px;line-height:1.5;margin:12px 0">
          Real keys are long (often 40–80+ characters). The placeholder
          <code style="color:#fbbf24">pk_test_your_clerk_publishable_key</code> must be fully replaced.
        </p>
        <p style="color:#64748b;font-size:12px;margin:0;line-height:1.5">
          Save → stop Vite (Ctrl+C) → <code>npm run dev</code> from the <code>frontend</code> folder → hard refresh.
          Env vars are read only at Vite startup.
        </p>
      </div>
    </div>`;
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <ClerkProvider publishableKey={publishableKey}>
        <AppRouter />
      </ClerkProvider>
    </StrictMode>,
  );
}
