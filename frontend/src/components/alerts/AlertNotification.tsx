import { useEffect, useState } from "react";
import { ShieldAlert, X, BellRing, CheckCircle2, UserCheck } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { AnomalyAlert } from "../../types";
import { playAnomalyAlarm, playClickPulse, playSuccessChime } from "../../utils/audio";

interface AlertNotificationProps {
  alerts: AnomalyAlert[];
  onDismiss: (id: string) => void;
  onApproveHitl?: (alert: AnomalyAlert) => Promise<void>;
  onRejectHitl?: (alert: AnomalyAlert) => void;
}

export default function AlertNotification({
  alerts,
  onDismiss,
  onApproveHitl,
  onRejectHitl,
}: AlertNotificationProps) {
  const activeAlerts = alerts.filter((a) => !a.resolved && a.hitlStatus !== "approved");
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (activeAlerts.length > 0) playAnomalyAlarm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAlerts.length]);

  if (activeAlerts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 w-full max-w-sm px-4 md:px-0">
      <AnimatePresence>
        {activeAlerts.slice(0, 4).map((alert) => (
          <motion.div
            key={alert.id}
            initial={{ opacity: 0, x: 50, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 50, scale: 0.95 }}
            className={`relative border backdrop-blur-xl rounded-xl p-4 shadow-[0_0_20px_rgba(244,63,94,0.15)] flex gap-3 text-left overflow-hidden group ${
              alert.hitl
                ? "border-violet-500 bg-slate-950/95"
                : "border-rose-500 bg-slate-950/95"
            }`}
          >
            <div
              className={`absolute top-0 left-0 w-1 h-full animate-pulse ${
                alert.hitl ? "bg-violet-500" : "bg-rose-500"
              }`}
            />
            <div
              className={`p-2.5 border rounded-lg h-fit flex-shrink-0 animate-bounce ${
                alert.hitl
                  ? "bg-violet-500/10 border-violet-500/30"
                  : "bg-rose-500/10 border-rose-500/30"
              }`}
            >
              {alert.hitl ? (
                <UserCheck className="w-6 h-6 text-violet-300" />
              ) : (
                <ShieldAlert className="w-6 h-6 text-rose-400" />
              )}
            </div>

            <div className="flex-grow min-w-0">
              <div className="flex items-center justify-between mb-1 gap-2">
                <span
                  className={`text-[10px] font-mono uppercase tracking-widest font-extrabold flex items-center gap-1 ${
                    alert.hitl ? "text-violet-300" : "text-rose-400"
                  }`}
                >
                  <BellRing className="w-3 h-3 animate-ping" />
                  {alert.hitl ? "HITL · NEWLY LEARNED" : "CRITICAL THREAT ISO"}
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
                <div className="mt-3 space-y-2">
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
                <div className="flex items-center justify-between mt-3 text-[10px] font-mono">
                  <span className="text-pink-400">THREAT_LEVEL: {alert.threatIndex.toFixed(1)}/10.0</span>
                  <button
                    type="button"
                    onClick={() => {
                      playClickPulse();
                      onDismiss(alert.id);
                    }}
                    className="px-2.5 py-1 border border-rose-500/20 rounded bg-rose-500/5 hover:bg-rose-500/20 hover:border-rose-400 text-rose-300 transition uppercase cursor-pointer text-[9px]"
                  >
                    DEACTIVATE
                  </button>
                </div>
              )}
            </div>

            {!alert.hitl && (
              <button
                type="button"
                onClick={() => {
                  playClickPulse();
                  onDismiss(alert.id);
                }}
                className="absolute top-2 right-2 text-red-400 hover:text-white p-1 rounded transition cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
