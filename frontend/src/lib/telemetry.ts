import { clamp, formatTimeLabel, randn, round } from "@/lib/utils";

export type MetricKey = "t1" | "t2" | "gate1q" | "gate2q" | "readout" | "temp" | "vibration" | "em";

export type Point = {
  ts: number;
  label: string;
  t1: number; // us
  t2: number; // us
  gate1q: number; // %
  gate2q: number; // %
  readout: number; // % error
  temp: number; // K
  vibration: number; // a.u.
  em: number; // a.u.
};

export type Alert = {
  id: string;
  ts: number;
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  qubit?: string;
};

export type DriftState = {
  ema: Record<MetricKey, number>;
  resMean: Record<MetricKey, number>;
  resVar: Record<MetricKey, number>;
};

const KEYS: MetricKey[] = ["t1", "t2", "gate1q", "gate2q", "readout", "temp", "vibration", "em"];

export function computeHealthScore(p: Point) {
  const t1 = clamp((p.t1 - 30) / 80, 0, 1);
  const t2 = clamp((p.t2 - 20) / 60, 0, 1);
  const g1 = clamp((p.gate1q - 99.2) / 0.7, 0, 1);
  const g2 = clamp((p.gate2q - 97.5) / 2.2, 0, 1);
  const ro = clamp((2.5 - p.readout) / 2.5, 0, 1);
  const env = 1 - clamp(((p.temp - 0.015) / 0.02 + p.vibration / 1.8 + p.em / 1.8) / 3, 0, 1);
  const score = 100 * (0.22 * t1 + 0.22 * t2 + 0.18 * g1 + 0.18 * g2 + 0.12 * ro + 0.08 * env);
  return round(score, 1);
}

function emaUpdate(prev: number, x: number, alpha: number) {
  return prev + alpha * (x - prev);
}

function zScore(residual: number, mean: number, stdev: number) {
  return stdev > 1e-9 ? (residual - mean) / stdev : 0;
}

export function initDriftState(p: Point): DriftState {
  const ema: any = {};
  const resMean: any = {};
  const resVar: any = {};
  for (const k of KEYS) {
    ema[k] = (p as any)[k];
    resMean[k] = 0;
    resVar[k] = 1;
  }
  return { ema, resMean, resVar };
}

export function updateDriftState(state: DriftState, p: Point, alpha = 0.08): DriftState {
  const next: DriftState = {
    ema: { ...state.ema },
    resMean: { ...state.resMean },
    resVar: { ...state.resVar },
  };

  for (const k of KEYS) {
    const x = (p as any)[k] as number;
    const baseline = next.ema[k];
    const newEma = emaUpdate(baseline, x, alpha);
    const residual = x - newEma;

    const m = next.resMean[k];
    const v = next.resVar[k];
    const m2 = emaUpdate(m, residual, 0.05);
    const v2 = emaUpdate(v, (residual - m2) ** 2, 0.05);

    next.ema[k] = newEma;
    next.resMean[k] = m2;
    next.resVar[k] = v2;
  }

  return next;
}

export function driftScore(state: DriftState, p: Point) {
  const weights: Record<MetricKey, number> = {
    t1: 1.2,
    t2: 1.1,
    gate1q: 1.0,
    gate2q: 1.2,
    readout: 1.0,
    temp: 0.8,
    vibration: 0.7,
    em: 0.7,
  };

  let total = 0;
  let wsum = 0;

  for (const k of KEYS) {
    const x = (p as any)[k] as number;
    const baseline = state.ema[k];
    const residual = x - baseline;
    const z = Math.abs(zScore(residual, state.resMean[k], Math.sqrt(state.resVar[k])));
    const w = weights[k];
    total += w * z;
    wsum += w;
  }

  return total / Math.max(1e-9, wsum);
}

export function makeInitialSeries(n = 90): Point[] {
  const now = Date.now();
  const dt = 2000;
  const base = {
    t1: 95,
    t2: 70,
    gate1q: 99.7,
    gate2q: 99.1,
    readout: 1.5,
    temp: 0.012,
    vibration: 0.6,
    em: 0.55,
  };

  const series: Point[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const ts = now - i * dt;
    const t = (n - i) / n;

    const drift = (t - 0.5) * 0.6;
    const tempBump = 0.002 * Math.sin(t * Math.PI * 2.2);

    series.push({
      ts,
      label: formatTimeLabel(ts),
      t1: round(base.t1 + randn() * 1.8 - 2.2 * drift, 2),
      t2: round(base.t2 + randn() * 1.6 - 1.8 * drift, 2),
      gate1q: round(base.gate1q + randn() * 0.03 - 0.02 * drift, 3),
      gate2q: round(base.gate2q + randn() * 0.06 - 0.05 * drift, 3),
      readout: round(base.readout + Math.abs(randn() * 0.15) + 0.08 * drift, 3),
      temp: round(base.temp + Math.abs(randn() * 0.0007) + tempBump + 0.0009 * drift, 5),
      vibration: round(base.vibration + Math.abs(randn() * 0.09) + 0.03 * Math.max(0, drift), 3),
      em: round(base.em + Math.abs(randn() * 0.08) + 0.03 * Math.max(0, drift), 3),
    });
  }

  return series;
}