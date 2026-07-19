import { useEffect, useState } from "react";
import { AuthenticateWithRedirectCallback, useSignIn } from "@clerk/react";
import {
  Key,
  Cpu,
  Terminal as TermIcon,
  Volume2,
  VolumeX,
  CheckCircle2,
  AlertTriangle,
  Chrome,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { Expertise } from "../types";
import { loadExpertise, saveExpertise } from "../hooks/useOperator";
import {
  playHoverTick,
  playClickPulse,
  playBootSweep,
  isSoundEnabled,
  setSoundEnabled,
} from "../utils/audio";

interface LoginPageProps {
  isCallback: boolean;
}

const EXPERTISE_OPTIONS: { id: Expertise; name: string; desc: string }[] = [
  { id: "DB", name: "Database (DB)", desc: "Pool saturation & lock metrics" },
  { id: "Network", name: "Network Ops", desc: "WAF blocks, DDoS, auth routing" },
  { id: "Memory", name: "Memory / Heap", desc: "K8s OOM, leaks, heap bounds" },
  { id: "CPU", name: "Compute / CPU", desc: "Crypto verification, worker limits" },
];

const PHRASES = [
  "COGNITIVE OBSERVABILITY CORE",
  "NETRA DEFENSE SHIELD ACTIVE",
  "MONITORING SYSTEM LATENCY",
  "VECTOR EMBEDDING ENGINE STANDBY",
  "5-AGENT SYNERGY: INITIALISED",
];

export default function LoginPage({ isCallback }: LoginPageProps) {
  const { signIn, isLoaded } = useSignIn();
  const [sound, setSound] = useState(isSoundEnabled());
  const [expertise, setExpertise] = useState<Expertise[]>(loadExpertise);
  const [error, setError] = useState<string | null>(null);
  const [booting, setBooting] = useState(false);
  const [decryptedText, setDecryptedText] = useState(PHRASES[0]);

  useEffect(() => {
    let idx = 0;
    const interval = setInterval(() => {
      idx = (idx + 1) % PHRASES.length;
      setDecryptedText(PHRASES[idx]);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  if (isCallback) {
    return <AuthenticateWithRedirectCallback signInForceRedirectUrl="/analyze" />;
  }

  const toggleExpertise = (id: Expertise) => {
    playClickPulse();
    setExpertise((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (next.length > 0) setError(null);
      return next;
    });
  };

  const handleSoundToggle = () => {
    const next = !sound;
    setSound(next);
    setSoundEnabled(next);
    if (next) setTimeout(() => playClickPulse(), 50);
  };

  const continueWithGoogle = () => {
    playClickPulse();
    if (expertise.length === 0) {
      setError("AUTHENTICATION EXCEPTION: select at least one operational expertise domain.");
      return;
    }
    if (!isLoaded || !signIn) {
      setError("AUTH CORE INITIALIZING — retry in a moment.");
      return;
    }
    setBooting(true);
    playBootSweep();
    saveExpertise(expertise);
    void signIn.authenticateWithRedirect({
      strategy: "oauth_google",
      redirectUrl: "/login/sso-callback",
      redirectUrlComplete: "/analyze",
    });
  };

  return (
    <div className="relative min-h-screen bg-slate-950 flex items-center justify-center overflow-hidden font-sans text-slate-300">
      {/* Futuristic grid & cyber accents */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-50" />
      <div className="absolute top-1/4 left-1/4 w-[350px] h-[350px] bg-cyan-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-blue-500/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="absolute top-8 left-8 hidden lg:block text-left text-[10px] font-mono text-slate-500 select-none">
        <div>SYS.LOC: MULTI_REGIONAL_NODES</div>
        <div>NETRA_CORE: v4.0_ACTIVE</div>
        <div>STATION: SECURE_COCKPIT_PRIME</div>
      </div>

      <div className="relative w-full max-w-lg mx-4 z-10">
        <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 rounded-2xl blur-sm opacity-20 transition duration-1000" />

        <div className="relative bg-slate-900 border border-slate-800 rounded-2xl p-8 backdrop-blur-md shadow-2xl shadow-cyan-950/5">
          <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-slate-700 rounded-tl-xl" />
          <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-slate-700 rounded-tr-xl" />
          <div className="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-slate-700 rounded-bl-xl" />
          <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-slate-700 rounded-br-xl" />

          <button
            type="button"
            onClick={handleSoundToggle}
            className="absolute top-4 right-4 p-2 rounded-md border border-slate-800 bg-slate-950/60 text-slate-400 hover:bg-slate-800 hover:border-slate-700 transition cursor-pointer"
            title="Toggle Audio Feedback"
          >
            {sound ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>

          <div className="text-center mb-8 flex flex-col items-center">
            <div className="inline-flex items-center justify-center mb-4">
              <div className="w-12 h-12 bg-cyan-500 rounded-sm rotate-45 flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                <div className="w-4 h-4 bg-slate-950 rounded-full" />
              </div>
            </div>
            <h1 className="text-3xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600">
              NETRA.AI
            </h1>
            <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400 font-mono mt-1 h-4">
              {decryptedText}
            </p>
          </div>

          <div className="space-y-6">
            {/* Expertise selection */}
            <div
              className={`space-y-2 p-2 rounded-xl border transition ${
                expertise.length === 0 ? "border-red-500/30 bg-red-950/5" : "border-transparent"
              }`}
            >
              <div className="flex justify-between items-center">
                <label
                  className={`block text-xs font-mono uppercase tracking-wider ${
                    expertise.length === 0 ? "text-red-400 font-bold" : "text-slate-400"
                  }`}
                >
                  Operational Expertise (Intent-Routing Key)
                </label>
                {expertise.length === 0 && (
                  <span className="text-[10px] font-mono text-red-400 animate-pulse font-bold">REQUIRED *</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {EXPERTISE_OPTIONS.map((item) => {
                  const isSelected = expertise.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={playHoverTick}
                      onClick={() => toggleExpertise(item.id)}
                      className={`p-2.5 rounded-lg border text-left transition cursor-pointer ${
                        isSelected
                          ? "border-cyan-500 bg-cyan-950/20 shadow-[0_0_10px_rgba(6,182,212,0.1)] text-cyan-200 font-semibold"
                          : "border-slate-800 bg-slate-950/60 hover:bg-slate-900 text-slate-400"
                      }`}
                    >
                      <div className="text-[11px] uppercase tracking-wide">{item.name}</div>
                      <div className="text-[9px] text-slate-500 mt-0.5 leading-snug">{item.desc}</div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] font-mono text-slate-500 mt-1">
                Netra routes automated Jira tickets to you when an incident matches your expertise.
              </p>
            </div>

            {/* Secrets managed server-side notice (no client-side API key) */}
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-950 border border-slate-800 text-slate-400">
              <Key className="w-4 h-4 text-cyan-500/80 mt-0.5 flex-shrink-0" />
              <p className="text-[10px] font-mono leading-relaxed">
                LLM credentials are held securely server-side (OpenRouter). No API keys are entered
                or stored in the browser.
              </p>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="p-3 bg-red-950/30 border border-red-500/20 rounded-lg flex items-start gap-2.5 text-red-300 text-xs text-left"
                >
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 text-red-400 mt-0.5" />
                  <span className="font-mono leading-tight">{error}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="button"
              disabled={booting}
              onMouseEnter={playHoverTick}
              onClick={continueWithGoogle}
              className={`relative w-full py-3.5 rounded-lg overflow-hidden font-bold tracking-wider text-sm text-black cursor-pointer bg-gradient-to-r from-cyan-400 via-cyan-500 to-blue-600 hover:shadow-[0_0_15px_rgba(6,182,212,0.35)] transition ${
                booting ? "opacity-80 cursor-wait" : "hover:scale-[1.01]"
              }`}
            >
              {booting ? (
                <span className="flex items-center justify-center gap-2">
                  <Cpu className="w-4 h-4 animate-spin text-black" />
                  BOOTING SECURE TERMINAL…
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2 text-black uppercase font-black tracking-widest">
                  <Chrome className="w-4 h-4 text-black" />
                  Continue with Google
                </span>
              )}
            </button>

            <div className="flex items-center justify-center gap-2 text-[10px] font-mono text-slate-500">
              <TermIcon className="w-3 h-3" />
              <span>Protected by Clerk · Google OAuth</span>
              <CheckCircle2 className="w-3 h-3 text-emerald-500" />
            </div>
          </div>

          <div className="mt-8 border-t border-cyan-500/10 pt-4 flex justify-between items-center text-[10px] font-mono text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-cyan-400 rounded-full animate-ping" />
              NETRA NETWORK: ACTIVE
            </span>
            <span>SECURE SECRETS: SERVER_SIDE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
