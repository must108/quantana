// components/quantum/QuantumDashboard.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Activity, Bell, Cpu, Gauge, Search, Settings, ShieldCheck, Sparkles } from "lucide-react";

import MetricPill from "@/components/quantum/metric-pill";
import QubitTable, { QubitRow } from "@/components/quantum/qubit-table";
import { SimpleLine, SparklineArea } from "@/components/quantum/charts";

import {
  Alert,
  DriftState,
  Point,
  computeHealthScore,
  driftScore,
  initDriftState,
  makeInitialSeries,
  nextPoint,
  updateDriftState,
} from "@/lib/telemetry";
import { clamp, formatTimeLabel, round, seededHash } from "@/lib/utils";

function severityColor(sev: Alert["severity"]) {
  if (sev === "critical") return "bg-red-500/15 text-red-700 border-red-500/25";
  if (sev === "warn") return "bg-amber-500/15 text-amber-800 border-amber-500/25";
  return "bg-sky-500/15 text-sky-800 border-sky-500/25";
}

export default function QuantumDashboard() {
  const [series, setSeries] = useState<Point[]>(() => makeInitialSeries(90));
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedMetric, setSelectedMetric] = useState<"Quantum" | "Environment">("Quantum");
  const [intensity, setIntensity] = useState(1.0);
  const [thresholds, setThresholds] = useState({ driftWarn: 1.6, driftCritical: 2.2 });

  const driftRef = useRef<DriftState | null>(null);
  const [drift, setDrift] = useState(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const latest = series[series.length - 1];
  const health = useMemo(() => computeHealthScore(latest), [latest]);

  // init drift model once (warm-up)
  useEffect(() => {
    if (!driftRef.current && series.length > 0) {
      driftRef.current = initDriftState(series[0]);
      let s = driftRef.current;
      for (const p of series) s = updateDriftState(s, p, 0.06);
      driftRef.current = s;
      setDrift(driftScore(s, latest));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (paused) return;

    const timer = setInterval(() => {
      setSeries((prev) => {
        const last = prev[prev.length - 1];
        const injectSpike = Math.random() < 0.065;
        const p = nextPoint(last, intensity, injectSpike);

        const ds = driftRef.current ? updateDriftState(driftRef.current, p, 0.08) : initDriftState(p);
        driftRef.current = ds;

        const dscore = driftScore(ds, p);
        setDrift(dscore);

        const nextAlerts: Alert[] = [];
        const tnow = p.ts;
        const idBase = `${tnow}-${Math.floor(Math.random() * 1e9)}`;

        if (dscore >= thresholds.driftCritical) {
          nextAlerts.push({
            id: `crit-${idBase}`,
            ts: tnow,
            severity: "critical",
            title: "Drift critical",
            detail: `Composite drift score ${round(dscore, 2)} exceeded critical threshold (${thresholds.driftCritical}).`,
          });
        } else if (dscore >= thresholds.driftWarn) {
          nextAlerts.push({
            id: `warn-${idBase}`,
            ts: tnow,
            severity: "warn",
            title: "Drift warning",
            detail: `Composite drift score ${round(dscore, 2)} exceeded warning threshold (${thresholds.driftWarn}).`,
          });
        }

        if (p.temp >= 0.03) {
          nextAlerts.push({
            id: `temp-${idBase}`,
            ts: tnow,
            severity: "warn",
            title: "Cryostat temperature elevated",
            detail: `Temperature ${round(p.temp, 5)} K above expected range.`,
          });
        }

        if (p.vibration >= 2.0 || p.em >= 2.0) {
          nextAlerts.push({
            id: `env-${idBase}`,
            ts: tnow,
            severity: p.vibration >= 2.4 || p.em >= 2.4 ? "critical" : "warn",
            title: "Environmental interference",
            detail: `Vibration ${round(p.vibration, 2)} / EM ${round(p.em, 2)} high — investigate shielding / isolation.`,
          });
        }

        // simple predictive hint
        const recent = prev.slice(-12);
        const prevBlock = prev.slice(-24, -12);
        const avg = (arr: Point[], k: keyof Point) =>
          arr.reduce((acc, r) => acc + (r[k] as number), 0) / Math.max(1, arr.length);

        const t1Trend = avg(recent, "t1") - avg(prevBlock, "t1");
        if (recent.length >= 12 && prevBlock.length >= 12 && t1Trend < -1.4) {
          nextAlerts.push({
            id: `pm-${idBase}`,
            ts: tnow,
            severity: "info",
            title: "Predictive signal: coherence degrading",
            detail: `Recent T1 trend indicates sustained decline (${round(t1Trend, 2)}µs over ~24s). Consider recalibration run.`,
          });
        }

        if (nextAlerts.length) setAlerts((a) => [...nextAlerts.reverse(), ...a].slice(0, 10));

        return [...prev.slice(-89), p];
      });
    }, 2000);

    return () => clearInterval(timer);
  }, [paused, intensity, thresholds.driftCritical, thresholds.driftWarn]);

  const envRisk = useMemo(() => {
    const t = clamp((latest.temp - 0.012) / 0.025, 0, 1);
    const v = clamp(latest.vibration / 2.5, 0, 1);
    const e = clamp(latest.em / 2.5, 0, 1);
    return round(100 * (0.34 * t + 0.33 * v + 0.33 * e), 1);
  }, [latest]);

  const systemStatus = useMemo<"Healthy" | "Degraded" | "Critical">(() => {
    if (drift >= thresholds.driftCritical || health < 55) return "Critical";
    if (drift >= thresholds.driftWarn || health < 72) return "Degraded";
    return "Healthy";
  }, [drift, health, thresholds]);

  const qubits = useMemo<QubitRow[]>(() => {
    const ids = Array.from({ length: 12 }, (_, i) => `q${i}`);
    return ids
      .map((id) => {
        const s = seededHash(id);
        const jitter = (mag: number) => (s - 0.5) * mag;

        const t1 = clamp(latest.t1 + jitter(9), 18, 130);
        const t2 = clamp(latest.t2 + jitter(8), 12, 100);
        const g1 = clamp(latest.gate1q + jitter(0.08), 98.8, 99.9);
        const g2 = clamp(latest.gate2q + jitter(0.14), 97.2, 99.6);
        const ro = clamp(latest.readout + Math.abs(jitter(0.5)), 0.4, 6.5);

        const ds =
          drift +
          clamp((80 - t1) / 60, 0, 2.2) * 0.35 +
          clamp((62 - t2) / 50, 0, 2.2) * 0.25 +
          clamp((99.5 - g1) / 0.6, 0, 2.2) * 0.35 +
          clamp((99.0 - g2) / 1.2, 0, 2.2) * 0.35 +
          clamp((ro - 1.5) / 3.5, 0, 2.2) * 0.25;

        const status: QubitRow["status"] = ds >= thresholds.driftCritical ? "Critical" : ds >= thresholds.driftWarn ? "Degraded" : "Healthy";

        return { id, status, t1, t2, gate1q: g1, gate2q: g2, readout: ro, driftScore: ds };
      })
      .filter((r) => r.id.toLowerCase().includes(search.toLowerCase().trim()));
  }, [latest, drift, thresholds, search]);

  const chartLines = useMemo(() => {
    if (selectedMetric === "Quantum") {
      return [
        { key: "t1" as const, name: "T1 (µs)" },
        { key: "t2" as const, name: "T2 (µs)" },
        { key: "readout" as const, name: "Readout Error (%)" },
      ];
    }
    return [
      { key: "temp" as const, name: "Temp (K)" },
      { key: "vibration" as const, name: "Vibration (a.u.)" },
      { key: "em" as const, name: "EM Noise (a.u.)" },
    ];
  }, [selectedMetric]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 text-zinc-900">
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Top bar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-zinc-900 text-zinc-50 shadow">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">Quantana</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search qubits (e.g., q3)" className="w-56 pl-9" />
            </div>
            <Button variant="outline" onClick={() => setPaused((p) => !p)}>
              {paused ? "Resume" : "Pause"}
            </Button>
            <Button variant="outline" onClick={() => setAlerts([])}>
              Clear Alerts
            </Button>
            <Button variant="ghost" size="icon" aria-label="Settings">
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </div>

        <Separator className="my-6" />

        {/* Status row */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-4 rounded-2xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm font-semibold text-zinc-700">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> System Health
                </span>
                <Badge
                  className={
                    systemStatus === "Healthy"
                      ? "bg-emerald-500/15 text-emerald-800 border border-emerald-500/25"
                      : systemStatus === "Degraded"
                        ? "bg-amber-500/15 text-amber-900 border border-amber-500/25"
                        : "bg-red-500/15 text-red-800 border border-red-500/25"
                  }
                >
                  {systemStatus}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-semibold tracking-tight tabular-nums">{health}</div>
                  <div className="text-xs text-muted-foreground">Health score (0–100)</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Activity className="h-4 w-4" />
                  <span className="tabular-nums">Uptime 99.98%</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <MetricPill label="T1" value={String(round(latest.t1, 1))} unit="µs" />
                <MetricPill label="T2" value={String(round(latest.t2, 1))} unit="µs" />
                <MetricPill label="1Q Fidelity" value={String(round(latest.gate1q, 3))} unit="%" />
                <MetricPill label="2Q Fidelity" value={String(round(latest.gate2q, 3))} unit="%" />
                <MetricPill label="Readout Error" value={String(round(latest.readout, 3))} unit="%" />
                <MetricPill label="Env Risk" value={String(envRisk)} unit="/100" subtle={envRisk < 30} />
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4 rounded-2xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm font-semibold text-zinc-700">
                <span className="flex items-center gap-2">
                  <Gauge className="h-4 w-4" /> Drift Flagging
                </span>
                <Badge
                  className={
                    drift >= thresholds.driftCritical
                      ? "bg-red-500/15 text-red-800 border border-red-500/25"
                      : drift >= thresholds.driftWarn
                        ? "bg-amber-500/15 text-amber-900 border border-amber-500/25"
                        : "bg-emerald-500/15 text-emerald-800 border border-emerald-500/25"
                  }
                >
                  {drift >= thresholds.driftCritical ? "Critical" : drift >= thresholds.driftWarn ? "Warning" : "Normal"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-3xl font-semibold tracking-tight tabular-nums">{round(drift, 2)}</div>
                  <div className="text-xs text-muted-foreground">Composite drift score (z-weighted)</div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <div className="tabular-nums">Warn ≥ {thresholds.driftWarn}</div>
                  <div className="tabular-nums">Crit ≥ {thresholds.driftCritical}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border bg-white/60 px-3 py-2 shadow-sm backdrop-blur-sm">
                  <div className="text-xs font-medium text-muted-foreground">Sensitivity</div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant={intensity <= 0.85 ? "default" : "outline"} onClick={() => setIntensity(0.8)} className="rounded-xl">
                      Low
                    </Button>
                    <Button
                      size="sm"
                      variant={intensity > 0.85 && intensity < 1.25 ? "default" : "outline"}
                      onClick={() => setIntensity(1.0)}
                      className="rounded-xl"
                    >
                      Med
                    </Button>
                    <Button size="sm" variant={intensity >= 1.25 ? "default" : "outline"} onClick={() => setIntensity(1.4)} className="rounded-xl">
                      High
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border bg-white/60 px-3 py-2 shadow-sm backdrop-blur-sm">
                  <div className="text-xs font-medium text-muted-foreground">Thresholds</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Input
                      value={String(thresholds.driftWarn)}
                      onChange={(e) => setThresholds((t) => ({ ...t, driftWarn: clamp(Number(e.target.value || 0), 0.8, 4) }))}
                      className="h-8 rounded-xl text-xs"
                      placeholder="Warn"
                    />
                    <Input
                      value={String(thresholds.driftCritical)}
                      onChange={(e) => setThresholds((t) => ({ ...t, driftCritical: clamp(Number(e.target.value || 0), 1.0, 5) }))}
                      className="h-8 rounded-xl text-xs"
                      placeholder="Crit"
                    />
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">Drift model: EMA baseline + residual z-score per metric, weighted aggregate.</div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4 rounded-2xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm font-semibold text-zinc-700">
                <span className="flex items-center gap-2">
                  <Bell className="h-4 w-4" /> Alerts
                </span>
                <Badge className="bg-zinc-900/5 text-zinc-700 border border-zinc-900/10">{alerts.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {alerts.length === 0 ? (
                <div className="rounded-xl border bg-white/60 p-3 text-sm text-muted-foreground shadow-sm backdrop-blur-sm">
                  No active alerts. Monitoring telemetry in real time.
                </div>
              ) : (
                <div className="space-y-2">
                  {alerts.map((a) => (
                    <div key={a.id} className={"rounded-xl border px-3 py-2 shadow-sm backdrop-blur-sm " + severityColor(a.severity)}>
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold">{a.title}</div>
                        <div className="text-xs tabular-nums opacity-80">{formatTimeLabel(a.ts)}</div>
                      </div>
                      <div className="mt-1 text-xs opacity-90">{a.detail}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="my-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-8 rounded-2xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-zinc-700">
                <span className="flex items-center gap-2">
                  <Cpu className="h-4 w-4" /> Telemetry
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant={selectedMetric === "Quantum" ? "default" : "outline"} onClick={() => setSelectedMetric("Quantum")} className="rounded-xl">
                    Quantum
                  </Button>
                  <Button
                    size="sm"
                    variant={selectedMetric === "Environment" ? "default" : "outline"}
                    onClick={() => setSelectedMetric("Environment")}
                    className="rounded-xl"
                  >
                    Environment
                  </Button>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <SimpleLine data={series} lines={chartLines} />
              <div className="mt-3 grid grid-cols-3 gap-3">
                <div className="rounded-xl border bg-white/60 p-3 shadow-sm backdrop-blur-sm">
                  <div className="text-xs font-medium text-muted-foreground">T1 Sparkline</div>
                  <div className="mt-2 text-zinc-900">
                    <SparklineArea data={series} dataKey="t1" />
                  </div>
                </div>
                <div className="rounded-xl border bg-white/60 p-3 shadow-sm backdrop-blur-sm">
                  <div className="text-xs font-medium text-muted-foreground">2Q Fidelity Sparkline</div>
                  <div className="mt-2 text-zinc-900">
                    <SparklineArea data={series} dataKey="gate2q" />
                  </div>
                </div>
                <div className="rounded-xl border bg-white/60 p-3 shadow-sm backdrop-blur-sm">
                  <div className="text-xs font-medium text-muted-foreground">Temperature Sparkline</div>
                  <div className="mt-2 text-zinc-900">
                    <SparklineArea data={series} dataKey="temp" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4 rounded-2xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm font-semibold text-zinc-700">
                <span className="flex items-center gap-2">
                  <Activity className="h-4 w-4" /> Controls
                </span>
                <Badge className="bg-zinc-900/5 text-zinc-700 border border-zinc-900/10">Prototype</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border bg-white/60 p-3 shadow-sm backdrop-blur-sm">
                <div className="text-xs font-medium text-muted-foreground">Calibration Actions</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() =>
                      setAlerts((a) =>
                        [
                          {
                            id: `info-${Date.now()}`,
                            ts: Date.now(),
                            severity: "info",
                            title: "Recalibration queued",
                            detail: "Scheduled calibration job: Ramsey + RB (single/two-qubit).",
                          },
                          ...a,
                        ].slice(0, 10)
                      )
                    }
                  >
                    Queue Recalibration
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() =>
                      setAlerts((a) =>
                        [
                          {
                            id: `info2-${Date.now()}`,
                            ts: Date.now(),
                            severity: "info",
                            title: "Diagnostics started",
                            detail: "Running environment scan: vibration isolation + EM shielding check.",
                          },
                          ...a,
                        ].slice(0, 10)
                      )
                    }
                  >
                    Run Diagnostics
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border bg-white/60 p-3 shadow-sm backdrop-blur-sm">
                <div className="text-xs font-medium text-muted-foreground">Alerting</div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl justify-start"
                    onClick={() =>
                      setAlerts((a) =>
                        [
                          {
                            id: `test-${Date.now()}`,
                            ts: Date.now(),
                            severity: "warn",
                            title: "Test alert",
                            detail: "This is a simulated warning to validate paging.",
                          },
                          ...a,
                        ].slice(0, 10)
                      )
                    }
                  >
                    Send Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-xl justify-start"
                    onClick={() => {
                      driftRef.current = initDriftState(series[series.length - 1]);
                      setAlerts((a) =>
                        [
                          {
                            id: `reset-${Date.now()}`,
                            ts: Date.now(),
                            severity: "info",
                            title: "Drift baseline reset",
                            detail: "EMA baseline reset to current telemetry snapshot.",
                          },
                          ...a,
                        ].slice(0, 10)
                      );
                    }}
                  >
                    Reset Baseline
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border bg-white/60 p-3 text-xs text-muted-foreground shadow-sm backdrop-blur-sm">
                <div className="flex items-center gap-2 font-medium text-zinc-700">
                  <Sparkles className="h-4 w-4" /> How to extend
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>Replace mock stream with API ingestion (WebSocket/SSE/Kafka).</li>
                  <li>Persist telemetry to a time-series DB (TimescaleDB/Influx/ClickHouse).</li>
                  <li>Add RB/Ramsey job hooks; store calibration artifacts per qubit.</li>
                  <li>Use robust anomaly detection (seasonal-HESD, Isolation Forest, LSTM).</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl border-zinc-200/70 bg-white/70 shadow-sm backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between text-sm font-semibold text-zinc-700">
              <span className="flex items-center gap-2">
                <Cpu className="h-4 w-4" /> Per-Qubit Metrics
              </span>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Activity className="h-4 w-4" /> Live
                </span>
                <span className="inline-flex items-center gap-1">
                  <Bell className="h-4 w-4" /> Alerting
                </span>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <QubitTable rows={qubits} />
          </CardContent>
        </Card>

        <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            <span>Quantana</span>
          </div>
          <div className="tabular-nums">Last update: {latest.label}</div>
        </div>
      </div>
    </div>
  );
}
