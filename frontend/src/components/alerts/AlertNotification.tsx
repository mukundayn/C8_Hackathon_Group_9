import { useEffect, useState } from "react";
import { ShieldAlert, X, BellRing, CheckCircle2, UserCheck } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { AnomalyAlert } from "../../types";
import { playAnomalyAlarm, playClickPulse, playSuccessChime } from "../../utils/audio";

interface AlertNotificationProps {
  alerts: AnomalyAlert[];
  onDismiss: (id: string) => void;
  onDismissAllThreats?: () => void;
  onDismissAllHitl?: () => void;
  onApproveHitl?: (alert: AnomalyAlert) => Promise<void>;
  onRejectHitl?: (alert: AnomalyAlert) => void;
}

/** Banner copy matches real severity — never label ERROR as CRITICAL. */
function threatBanner(alert: AnomalyAlert): {
  label: string;
  border: string;
  bar: string;
  iconWrap: string;
  icon: string;
  title: string;
} {
  if (alert.hitl) {
    return {
      label: "HITL · NEWLY LEARNED",
      border: "border-violet-500 bg-slate-950/95",
      bar: "bg-violet-500",
      iconWrap: "bg-violet-500/10 border-violet-500/30",
      icon: "text-violet-300",
      title: "text-violet-300",
    };
  }
  if (alert.severity === "CRITICAL") {
    return {
      label: "CRITICAL THREAT",
      border: "border-rose-500 bg-slate-950/95 shadow-[0_0_20px_rgba(244,63,94,0.12)]",
      bar: "bg-rose-500",
      iconWrap: "bg-rose-500/10 border-rose-500/30",
      icon: "text-rose-400",
      title: "text-rose-400",
    };
  }
  if (alert.severity === "ERROR") {
    return {
      label: "ERROR · ELEVATED",
      border: "border-amber-500/80 bg-slate-950/95 shadow-[0_0_16px_rgba(245,158,11,0.1)]",
      bar: "bg-amber-500",
      iconWrap: "bg-amber-500/10 border-amber-500/30",
      icon: "text-amber-400",
      title: "text-amber-400",
    };
  }
  return {
    label: "WARNING",
    border: "border-yellow-600/70 bg-slate-950/95",
    bar: "bg-yellow-500",
    iconWrap: "bg-yellow-500/10 border-yellow-500/30",
    icon: "text-yellow-400",
    title: "text-yellow-400",
  };
}

function AlertCard({
  alert,
  busyId,
  setBusyId,
  onDismiss,
  onApproveHitl,
  onRejectHitl,
}: {
  alert: AnomalyAlert;
  busyId: string | null;
  setBusyId: (id: string | null) => void;
  onDismiss: (id: string) => void;
  onApproveHitl?: (alert: AnomalyAlert) => Promise<void>;
  onRejectHitl?: (alert: AnomalyAlert) => void;
}) {
  const tone = threatBanner(alert);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96 }}
      className={`relative border backdrop-blur-xl rounded-xl p-3.5 flex gap-3 text-left overflow-hidden flex-shrink-0 ${tone.border}`}
    >
      <div className={`absolute top-0 left-0 w-1 h-full animate-pulse ${tone.bar}`} />
      <div className={`p-2 border rounded-lg h-fit flex-shrink-0 ${tone.iconWrap}`}>
        {alert.hitl ? (
          <UserCheck className={`w-5 h-5 ${tone.icon}`} />
        ) : (
          <ShieldAlert className={`w-5 h-5 ${tone.icon}`} />
        )}
      </div>

      <div className="flex-grow min-w-0">
        <div className="flex items-center justify-between mb-1 gap-2">
          <span
            className={`text-[10px] font-mono uppercase tracking-widest font-extrabold flex items-center gap-1 ${tone.title}`}
          >
            <BellRing className="w-3 h-3" />
            {tone.label}
          </span>
          <span className="text-[9px] font-mono text-slate-500 flex-shrink-0">{alert.timestamp}</span>
        </div>

        <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-1 leading-tight">
          {alert.title ||
            (alert.service ? `${alert.service}: Anomaly Log` : "Anomaly Signature Intercepted")}
        </h4>

        <p className="text-[11px] text-slate-300 font-mono bg-slate-900 border border-slate-800 p-2 rounded leading-snug line-clamp-3">
          {alert.message}
        </p>

        {alert.hitl ? (
          <div className="mt-2.5 space-y-2">
            <p className="text-[9px] font-mono text-violet-300/90 leading-relaxed">
              Approve to create Jira + Slack. Reject skips ticketing (pattern already in KB).
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busyId === alert.id || !onApproveHitl}
                onClick={() => {
                  if (!onApproveHitl) return;
                  playClickPulse();
                  setBusyId(alert.id);
                  void onApproveHitl(alert)
                    .then(() => playSuccessChime())
                    .finally(() => setBusyId(null));
                }}
                className="flex-1 flex items-center justify-center gap-1 px-2.5 py-1.5 border border-emerald-500/40 rounded bg-emerald-500/10 hover:bg-emerald-500/25 text-emerald-300 transition uppercase cursor-pointer text-[9px] font-mono disabled:opacity-50"
              >
                <CheckCircle2 className="w-3 h-3" />
                {busyId === alert.id ? "APPROVING…" : "APPROVE → JIRA+SLACK"}
              </button>
              <button
                type="button"
                disabled={busyId === alert.id}
                onClick={() => {
                  playClickPulse();
                  onRejectHitl?.(alert);
                  onDismiss(alert.id);
                }}
                className="px-2.5 py-1.5 border border-slate-600 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 transition uppercase cursor-pointer text-[9px] font-mono"
              >
                REJECT
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between mt-2.5 text-[10px] font-mono">
            <span
              className="text-pink-400"
              title={
                alert.threatSource === "llm"
                  ? "LLM-refined during analyze (critical/high), anchored to the live signal score"
                  : "Live signal score — severity, impact keywords, category, latency. LLM refine runs on analyze for critical/high."
              }
            >
              THREAT_LEVEL: {(alert.threatIndex ?? 0).toFixed(1)}/10.0
              {alert.threatSource === "llm" ? " · LLM" : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                playClickPulse();
                onDismiss(alert.id);
              }}
              className={`px-2.5 py-1 border rounded transition uppercase cursor-pointer text-[9px] ${
                alert.severity === "CRITICAL"
                  ? "border-rose-500/20 bg-rose-500/5 hover:bg-rose-500/20 hover:border-rose-400 text-rose-300"
                  : "border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/20 hover:border-amber-400 text-amber-300"
              }`}
            >
              DEACTIVATE
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          playClickPulse();
          if (alert.hitl) onRejectHitl?.(alert);
          onDismiss(alert.id);
        }}
        className="absolute top-2 right-2 text-slate-500 hover:text-white p-1 rounded transition cursor-pointer"
        title={alert.hitl ? "Reject / ignore" : "Dismiss"}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}

export default function AlertNotification({
  alerts,
  onDismiss,
  onDismissAllThreats,
  onDismissAllHitl,
  onApproveHitl,
  onRejectHitl,
}: AlertNotificationProps) {
  const active = alerts.filter((a) => !a.resolved && a.hitlStatus !== "approved");
  const hitlActive = active.filter((a) => a.hitl);
  const threatActive = active.filter((a) => !a.hitl);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (active.length > 0) playAnomalyAlarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.length]);

  if (active.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(100vw-1.5rem,24rem)] flex flex-col gap-2 max-h-[min(85vh,720px)]">
      {/* HITL stack */}
      {hitlActive.length > 0 && (
        <div className="flex flex-col min-h-0 max-h-[42%] border border-violet-500/30 rounded-xl bg-slate-950/90 backdrop-blur-md overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-violet-900/50 flex-shrink-0">
            <span className="text-[9px] font-mono uppercase tracking-widest text-violet-300">
              HITL pending · {hitlActive.length}
            </span>
            <button
              type="button"
              onClick={() => {
                playClickPulse();
                onDismissAllHitl?.();
              }}
              className="px-2 py-1 rounded border border-violet-500/40 bg-violet-950/40 text-violet-200 text-[9px] font-mono uppercase hover:bg-violet-900/50 cursor-pointer"
            >
              Ignore all ({hitlActive.length})
            </button>
          </div>
          <div className="overflow-y-auto custom-scrollbar p-2 flex flex-col gap-2 min-h-0">
            <AnimatePresence initial={false}>
              {hitlActive.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  busyId={busyId}
                  setBusyId={setBusyId}
                  onDismiss={onDismiss}
                  onApproveHitl={onApproveHitl}
                  onRejectHitl={onRejectHitl}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Live threat stack */}
      {threatActive.length > 0 && (
        <div className="flex flex-col min-h-0 flex-1 border border-rose-500/30 rounded-xl bg-slate-950/90 backdrop-blur-md overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-rose-900/50 flex-shrink-0">
            <span className="text-[9px] font-mono uppercase tracking-widest text-rose-300">
              Threat alerts · {threatActive.length}
            </span>
            <button
              type="button"
              onClick={() => {
                playClickPulse();
                onDismissAllThreats?.();
              }}
              className="px-2 py-1 rounded border border-rose-500/40 bg-rose-950/40 text-rose-200 text-[9px] font-mono uppercase hover:bg-rose-900/50 cursor-pointer"
            >
              Ignore all ({threatActive.length})
            </button>
          </div>
          <div className="overflow-y-auto custom-scrollbar p-2 flex flex-col gap-2 min-h-0">
            <AnimatePresence initial={false}>
              {threatActive.map((alert) => (
                <AlertCard
                  key={alert.id}
                  alert={alert}
                  busyId={busyId}
                  setBusyId={setBusyId}
                  onDismiss={onDismiss}
                  onApproveHitl={onApproveHitl}
                  onRejectHitl={onRejectHitl}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
