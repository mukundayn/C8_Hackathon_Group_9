import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import "./styles/index.css";
import AppRouter from "./AppRouter.tsx";

const publishableKey = import.meta.env.CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error("[Clerk] CLERK_PUBLISHABLE_KEY is required.");
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element #root not found in DOM");

createRoot(rootEl).render(
  <StrictMode>
    <ClerkProvider publishableKey={publishableKey}>
      <AppRouter />
    </ClerkProvider>
  </StrictMode>,
);
