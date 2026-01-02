"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Activity, Bell, Cpu, Gauge, Search, ShieldCheck } from "lucide-react";
import { Gi3dMeeple } from "react-icons/gi";
import { ThemeToggle } from "../theme-toggle";
import Link from "next/link";

import MetricPill from "@/components/quantum/metric-pill";
import QubitTable, { QubitRow } from "@/components/quantum/qubit-table";
import { SimpleLine, SparklineArea } from "@/components/quantum/charts";

import { Alert, DriftState, Point, computeHealthScore, driftScore, initDriftState, makeInitialSeries, updateDriftState } from "@/lib/telemetry";
import { clamp, formatTimeLabel, round, seededHash } from "@/lib/utils";

function alertClass(sev: Alert["severity"]) {
  if (sev === "critical") return "bg-red-500/10 border-red-500/20 text-foreground";
  if (sev === "warn") return "bg-amber-500/10 border-amber-500/20 text-foreground";
  return "bg-sky-500/10 border-sky-500/20 text-foreground";
}

function statusBadgeClass(status: "Healthy" | "Degraded" | "Critical") {
  if (status === "Healthy") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20";
  if (status === "Degraded") return "bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/20";
  return "bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/20";
}

function driftBadgeClass(drift: number, thresholds: { driftWarn: number; driftCritical: number }) {
  if (drift >= thresholds.driftCritical) return "bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/20";
  if (drift >= thresholds.driftWarn) return "bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/20";
  return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20";
}

function streamBadgeClass(streamStatus: "connecting" | "live" | "error") {
  if (streamStatus === "live") return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/20";
  if (streamStatus === "connecting") return "bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/20";
  return "bg-red-500/10 text-red-600 dark:text-red-300 border-red-500/20";
}

export default function QuantumDashboard() {
  const [mounted, setMounted] = useState(false);

  const [series, setSeries] = useState<Point[]>([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedMetric, setSelectedMetric] = useState<"Quantum" | "Environment">("Quantum");

  const [intensity, setIntensity] = useState(1.0);
  const [thresholds, setThresholds] = useState({ driftWarn: 1.6, driftCritical: 2.2 });
  const [thresholdInputs, setThresholdInputs] = useState({
    driftWarn: "1.6",
    driftCritical: "2.2"
  })
  const [streamStatus, setStreamStatus] = useState<"connecting" | "live" | "error">("connecting");

  const driftRef = useRef<DriftState | null>(null);
  const [drift, setDrift] = useState(0);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const alertSeqRef = useRef(0);
  const makeAlertId = (prefix: string, ts: number) => `${prefix}-${ts}-${alertSeqRef.current++}`;

  useEffect(() => {
    setMounted(true);

    const seed = makeInitialSeries(90);
    setSeries(seed);

    let ds = initDriftState(seed[0]);
    for (const p of seed) ds = updateDriftState(ds, p, 0.06);
    driftRef.current = ds;
    setDrift(driftScore(ds, seed[seed.length - 1]));
  }, []);

  const hasData = series.length > 0;
  const latest: Point = hasData
    ? series[series.length - 1]
    : {
        ts: 0,
        label: "—",
        t1: 0,
        t2: 0,
        gate1q: 0,
        gate2q: 0,
        readout: 0,
        temp: 0,
        vibration: 0,
        em: 0,
      };

  const health = useMemo(() => (hasData ? computeHealthScore(latest) : 0), [hasData, latest]);

  useEffect(() => {
    if (!mounted) return;
    if (!hasData) return;

    if (paused) {
      setStreamStatus("connecting");
      return;
    }

    setStreamStatus("connecting");
    const es = new EventSource("/api/stream");

    es.onopen = () => setStreamStatus("live");

    es.onmessage = (evt) => {
      let p: Point | null = null;
      try {
        p = JSON.parse(evt.data) as Point;
      } catch {
        return;
      }
      if (!p) return;

      const alpha = clamp(0.06 + (intensity - 1.0) * 0.03, 0.03, 0.14);

      const ds = driftRef.current ? updateDriftState(driftRef.current, p, alpha) : initDriftState(p);
      driftRef.current = ds;

      const dscore = driftScore(ds, p);
      setDrift(dscore);

      const nextAlerts: Alert[] = [];
      const tnow = p.ts;

      if (dscore >= thresholds.driftCritical) {
        nextAlerts.push({
          id: makeAlertId("crit", tnow),
          ts: tnow,
          severity: "critical",
          title: "Drift critical",
          detail: `Composite drift score ${round(dscore, 2)} exceeded critical threshold (${thresholds.driftCritical}).`,
        });
      } else if (dscore >= thresholds.driftWarn) {
        nextAlerts.push({
          id: makeAlertId("warn", tnow),
          ts: tnow,
          severity: "warn",
          title: "Drift warning",
          detail: `Composite drift score ${round(dscore, 2)} exceeded warning threshold (${thresholds.driftWarn}).`,
        });
      }

      if (p.temp >= 0.03) {
        nextAlerts.push({
          id: makeAlertId("temp", tnow),
          ts: tnow,
          severity: "warn",
          title: "Cryostat temperature elevated",
          detail: `Temperature ${round(p.temp, 5)} K above expected range.`,
        });
      }

      if (p.vibration >= 2.0 || p.em >= 2.0) {
        nextAlerts.push({
          id: makeAlertId("env", tnow),
          ts: tnow,
          severity: p.vibration >= 2.4 || p.em >= 2.4 ? "critical" : "warn",
          title: "Environmental interference",
          detail: `Vibration ${round(p.vibration, 2)} / EM ${round(p.em, 2)} high — investigate shielding / isolation.`,
        });
      }

      setSeries((prev) => {
        const next = [...prev.slice(-89), p];

        const recent = next.slice(-12);
        const prevBlock = next.slice(-24, -12);
        const avg = (arr: Point[], k: keyof Point) => arr.reduce((acc, r) => acc + (r[k] as number), 0) / Math.max(1, arr.length);

        const t1Trend = avg(recent, "t1") - avg(prevBlock, "t1");
        if (recent.length >= 12 && prevBlock.length >= 12 && t1Trend < -1.4) {
          nextAlerts.push({
            id: makeAlertId("pm", tnow),
            ts: tnow,
            severity: "info",
            title: "Predictive signal: coherence degrading",
            detail: `Recent T1 trend indicates sustained decline (${round(t1Trend, 2)}µs over ~24s). Consider recalibration run.`,
          });
        }

        if (nextAlerts.length) {
          setAlerts((a) => [...nextAlerts.reverse(), ...a].slice(0, 50));
        }

        return next;
      });
    };

    es.onerror = () => {
      setStreamStatus("error");
      es.close();
    };

    return () => es.close();
  }, [mounted, hasData, paused, thresholds.driftCritical, thresholds.driftWarn, intensity]);

  const envRisk = useMemo(() => {
    if (!hasData) return 0;
    const t = clamp((latest.temp - 0.012) / 0.025, 0, 1);
    const v = clamp(latest.vibration / 2.5, 0, 1);
    const e = clamp(latest.em / 2.5, 0, 1);
    return round(100 * (0.34 * t + 0.33 * v + 0.33 * e), 1);
  }, [hasData, latest]);

  const systemStatus = useMemo<"Healthy" | "Degraded" | "Critical">(() => {
    if (!hasData) return "Healthy";
    if (drift >= thresholds.driftCritical || health < 55) return "Critical";
    if (drift >= thresholds.driftWarn || health < 72) return "Degraded";
    return "Healthy";
  }, [hasData, drift, health, thresholds]);

  const qubits = useMemo<QubitRow[]>(() => {
    if (!hasData) return [];
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
  }, [hasData, latest, drift, thresholds, search]);

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

  const showLoading = !mounted || !hasData;

  return (
    <div className="min-h-screen bg-background text-foreground pb-40 md:pb-0">
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 dark:to-muted/10">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 md:items-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
                <Gi3dMeeple className="h-8 w-8" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 truncate text-lg font-semibold tracking-tight">Quantana</div>
                  <Badge className={"border " + streamBadgeClass(streamStatus)}>
                    {streamStatus === "live" ? "Live" : streamStatus === "connecting" ? "Connecting…" : "Stream error"}
                  </Badge>
                </div>
              </div>
            </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="order-2 flex w-full flex-col gap-2 sm:order-1 sm:w-auto sm:flex-row sm:items-center">
              <div>
                <Link href="/">
                  <Button variant="outline" className="w-full sm:w-auto">
                    Home
                  </Button>
                </Link>
              </div>
              <div className="relative w-full sm:w-64 md:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search qubits (e.g., q3)" className="w-full bg-background pl-9" />
              </div>
             <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
               <Button variant="outline" onClick={() => setPaused((p) => !p)} className="w-full sm:w-auto">
                 {paused ? "Resume" : "Pause"}
               </Button>
               <Button variant="outline" onClick={() => setAlerts([])} className="w-full sm:w-auto">
                 Clear Alerts
               </Button>
             </div>
           </div>

           <div className="order-1 flex justify-end sm:order-2">
             <ThemeToggle />
           </div>
            </div>
          </div>

          <Separator className="my-6" />

          {showLoading ? (
            <div className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Loading telemetry…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <Card className="lg:col-span-4 rounded-2xl bg-card text-card-foreground border-border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm font-semibold text-foreground">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <ShieldCheck className="h-4 w-4" /> <span className="text-foreground">System Health</span>
                      </span>
                      <Badge className={"border " + statusBadgeClass(systemStatus)}>{systemStatus}</Badge>
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

                <Card className="lg:col-span-4 rounded-2xl bg-card text-card-foreground border-border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm font-semibold text-foreground">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Gauge className="h-4 w-4" /> <span className="text-foreground">Drift Flagging</span>
                      </span>
                      <Badge className={"border " + driftBadgeClass(drift, thresholds)}>
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

                    <div className="grid grid-cols-8 gap-2">
                      <div className="col-span-5 rounded-xl border bg-muted/40 dark:bg-muted/25 px-3 py-2">
                        <div className="text-xs font-medium text-muted-foreground">Sensitivity (detector)</div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          <Button size="sm" variant={intensity <= 0.85 ? "default" : "outline"} onClick={() => setIntensity(0.8)} className="rounded-xl w-full">
                            Low
                          </Button>
                          <Button size="sm" variant={intensity > 0.85 && intensity < 1.25 ? "default" : "outline"} onClick={() => setIntensity(1.0)} className="rounded-xl w-full">
                            Med
                          </Button>
                          <Button size="sm" variant={intensity >= 1.25 ? "default" : "outline"} onClick={() => setIntensity(1.4)} className="rounded-xl w-full">
                            High
                          </Button>
                        </div>
                      </div>

                      <div className="col-span-3 rounded-xl border bg-muted/40 dark:bg-muted/25 px-3 py-2">
                        <div className="text-xs font-medium text-muted-foreground">Thresholds</div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <Input
                            value={thresholdInputs.driftWarn}
                            onChange={(e) =>
                              setThresholdInputs((s) => ({ ...s, driftWarn: e.target.value }))
                            }
                            onBlur={() =>
                              setThresholds((t) => ({
                                ...t,
                                driftWarn: clamp(Number(thresholdInputs.driftWarn), 0.8, 4),
                              }))
                            }
                            className="h-8 rounded-xl text-xs bg-background"
                            placeholder="Warn"
                            inputMode="decimal"
                          />
                          <Input
                            value={thresholdInputs.driftCritical}
                            onChange={(e) =>
                              setThresholdInputs((s) => ({ ...s, driftCritical: e.target.value }))
                            }
                            onBlur={() =>
                              setThresholds((t) => ({
                                ...t,
                                driftCritical: clamp(Number(thresholdInputs.driftCritical), 1.0, 5),
                              }))
                            }
                            className="h-8 rounded-xl text-xs bg-background"
                            placeholder="Crit"
                            inputMode="decimal"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-muted-foreground">Drift model: EMA baseline + residual z-score per metric, weighted aggregate.</div>
                  </CardContent>
                </Card>

                <Card className="lg:col-span-4 rounded-2xl bg-card text-card-foreground border-border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm font-semibold text-foreground">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Bell className="h-4 w-4" /> <span className="text-foreground">Alerts</span>
                      </span>
                      <Badge className="border bg-foreground text-background">{alerts.length}</Badge>
                    </CardTitle>
                  </CardHeader>

                  <CardContent className="space-y-2">
                    {alerts.length === 0 ? (
                      <div className="rounded-xl border bg-muted/40 dark:bg-muted/25 p-3 text-sm text-muted-foreground">No active alerts. Monitoring telemetry in real time.</div>
                    ) : (
                      <div className="max-h-[340px] overflow-y-auto pr-1 space-y-2">
                        {alerts.map((a) => (
                          <div key={a.id} className={"rounded-xl border px-3 py-2 shadow-sm " + alertClass(a.severity)}>
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-semibold">{a.title}</div>
                              <div className="text-xs tabular-nums text-muted-foreground">{formatTimeLabel(a.ts)}</div>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">{a.detail}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="my-6 grid grid-cols-1 gap-4">
                <Card className="lg:col-span-8 rounded-2xl bg-card text-card-foreground border-border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-sm font-semibold text-foreground">
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <Cpu className="h-4 w-4" /> <span className="text-foreground">Telemetry</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant={selectedMetric === "Quantum" ? "default" : "outline"} onClick={() => setSelectedMetric("Quantum")} className="rounded-xl">
                          Quantum
                        </Button>
                        <Button size="sm" variant={selectedMetric === "Environment" ? "default" : "outline"} onClick={() => setSelectedMetric("Environment")} className="rounded-xl">
                          Environment
                        </Button>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <SimpleLine data={series} lines={chartLines} />
                    <div className="mt-3 grid grid-cols-3 gap-3">
                      <div className="rounded-xl border bg-muted/40 dark:bg-muted/25 p-3">
                        <div className="text-xs font-medium text-muted-foreground">T1 Sparkline</div>
                        <div className="mt-2 text-foreground">
                          <SparklineArea data={series} dataKey="t1" />
                        </div>
                      </div>
                      <div className="rounded-xl border bg-muted/40 dark:bg-muted/25 p-3">
                        <div className="text-xs font-medium text-muted-foreground">2Q Fidelity Sparkline</div>
                        <div className="mt-2 text-foreground">
                          <SparklineArea data={series} dataKey="gate2q" />
                        </div>
                      </div>
                      <div className="rounded-xl border bg-muted/40 dark:bg-muted/25 p-3">
                        <div className="text-xs font-medium text-muted-foreground">Temperature Sparkline</div>
                        <div className="mt-2 text-foreground">
                          <SparklineArea data={series} dataKey="temp" />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-2xl bg-card text-card-foreground border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm font-semibold text-foreground">
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Cpu className="h-4 w-4" /> <span className="text-foreground">Per-Qubit Metrics</span>
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
                  <Gi3dMeeple className="h-4 w-4" />
                  <span>Quantana</span>
                </div>
                <div className="tabular-nums">Last update: {latest.label}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
