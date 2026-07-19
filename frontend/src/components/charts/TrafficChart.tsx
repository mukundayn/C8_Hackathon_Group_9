import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Activity } from "lucide-react";
import type { TrafficPoint } from "../../lib/api";

interface TrafficChartProps {
  points: TrafficPoint[];
}

const SEV_TICKS = [1, 2, 3, 4];
const SEV_LABEL: Record<number, string> = {
  1: "INFO",
  2: "WARN",
  3: "ERROR",
  4: "CRIT",
};

export default function TrafficChart({ points }: TrafficChartProps) {
  const chartData = points.map((p) => ({
    time: p.time,
    "Volume /sec": p.volume_per_sec ?? p.requests,
    "Errors (Fails)": p.errors,
    Severity: p.avg_severity ?? 0,
  }));

  return (
    <div className="border border-slate-800 bg-slate-900/40 rounded-2xl p-6 backdrop-blur-md relative h-full flex flex-col justify-between">
      <div className="absolute top-2 right-4 flex items-center gap-1.5 text-[10px] font-mono text-slate-500">
        <Activity className="w-3.5 h-3.5 animate-pulse" />
        CHART_ENGINE: RECHARTS
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 border-b border-slate-800/65 pb-4">
        <div>
          <h2 className="text-sm font-mono uppercase tracking-widest text-cyan-400 flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
            Vectored Network Traffic Analytics
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Volume/sec + severity from the live-feed buffer (webhook/logs) — not LangGraph output.
          </p>
        </div>
      </div>

      <div className="h-[280px] w-full mt-2">
        {chartData.length === 0 ? (
          <div className="h-full flex items-center justify-center text-slate-600 text-xs font-mono">
            AWAITING TELEMETRY — INGEST EVENTS VIA THE WEBHOOK CONNECTOR
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRequests" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorErrors" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a" opacity={0.3} />
              <XAxis dataKey="time" stroke="#475569" fontSize={10} fontFamily="monospace" tickLine={false} />
              <YAxis
                yAxisId="left"
                stroke="#06b6d4"
                fontSize={10}
                fontFamily="monospace"
                tickLine={false}
                axisLine={false}
                label={{
                  value: "vol/s",
                  angle: -90,
                  position: "insideLeft",
                  offset: 18,
                  style: { fill: "#06b6d4", fontSize: 9, fontFamily: "monospace" },
                }}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#f59e0b"
                fontSize={10}
                fontFamily="monospace"
                tickLine={false}
                axisLine={false}
                domain={[1, 4]}
                ticks={SEV_TICKS}
                tickFormatter={(v: number) => SEV_LABEL[v] ?? String(v)}
                label={{
                  value: "severity",
                  angle: 90,
                  position: "insideRight",
                  offset: 4,
                  style: { fill: "#f59e0b", fontSize: 9, fontFamily: "monospace" },
                }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#020617",
                  borderColor: "#1e293b",
                  borderRadius: "12px",
                  fontFamily: "monospace",
                  fontSize: "11px",
                  color: "#e2e8f0",
                }}
                cursor={{ stroke: "#0f172a", strokeWidth: 1 }}
                formatter={(value, name) => {
                  const n = typeof value === "number" ? value : Number(value ?? 0);
                  const label = String(name ?? "");
                  if (label === "Severity") {
                    const rounded = Math.round(n);
                    return [`${n.toFixed(2)} (${SEV_LABEL[rounded] ?? "?"})`, label];
                  }
                  return [Number.isFinite(n) ? n : 0, label];
                }}
              />
              <Legend wrapperStyle={{ fontSize: "10px", fontFamily: "monospace", marginTop: "10px" }} iconType="circle" />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="Volume /sec"
                stroke="#06b6d4"
                fillOpacity={1}
                fill="url(#colorRequests)"
                strokeWidth={2}
                activeDot={{ r: 6, strokeWidth: 0, fill: "#22d3ee" }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="Errors (Fails)"
                stroke="#f43f5e"
                fillOpacity={1}
                fill="url(#colorErrors)"
                strokeWidth={2}
                activeDot={{ r: 5, strokeWidth: 0, fill: "#fb7185" }}
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="Severity"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={{ r: 3, fill: "#fbbf24", strokeWidth: 0 }}
                activeDot={{ r: 5, strokeWidth: 0, fill: "#fbbf24" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-4 border-t border-cyan-500/10 pt-3 flex justify-between items-center text-[9px] font-mono text-gray-500">
        <span>SAMPLE BUCKETS: {chartData.length}</span>
        <span>SOURCE: /api/metrics/traffic · Y: vol/s + severity</span>
      </div>
    </div>
  );
}
