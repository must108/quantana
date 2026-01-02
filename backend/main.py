from __future__ import annotations

import math
import time
import json
from dataclasses import dataclass
from typing import Dict, Tuple, List, Optional

import numpy as np
from fastapi import FastAPI
from fastapi.responses import StreamingResponse

from scipy.optimize import curve_fit

from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator
from qiskit_aer.noise import NoiseModel, ReadoutError, depolarizing_error, thermal_relaxation_error

def exp_decay(t, a, T, c):
    return a * np.exp(-t / T) + c

def damped_cos(t, a, T2, w, phi, c):
    return a * np.exp(-t / T2) * np.cos(w * t + phi) + c

@dataclass
class HWState:
    T1_us: float
    T2_us: float

    p1q: float
    p2q: float

    p0to1: float
    p1to0: float

    temp_K: float
    vibration: float
    em: float

    start_ts: float


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def init_state() -> HWState:
    return HWState(
        T1_us=85.0,
        T2_us=55.0,
        p1q=0.0009,
        p2q=0.0080,
        p0to1=0.015,   
        p1to0=0.020,   
        temp_K=0.012,
        vibration=0.7,
        em=0.8,
        start_ts=time.time(),
    )


def step_state(s: HWState, dt_s: float = 2.0) -> HWState:
    rng = np.random.default_rng()

    spike = rng.random() < 0.05
    s.temp_K = clamp(s.temp_K + rng.normal(0, 0.0004) + (0.010 if spike and rng.random() < 0.25 else 0.0), 0.008, 0.050)
    s.vibration = clamp(s.vibration + rng.normal(0, 0.08) + (1.2 if spike and rng.random() < 0.20 else 0.0), 0.0, 3.0)
    s.em = clamp(s.em + rng.normal(0, 0.09) + (1.2 if spike and rng.random() < 0.20 else 0.0), 0.0, 3.0)

    temp_pressure = clamp((s.temp_K - 0.012) / 0.020, 0.0, 1.5)
    vib_pressure = clamp(s.vibration / 2.5, 0.0, 1.2)
    em_pressure = clamp(s.em / 2.5, 0.0, 1.2)
    pressure = 0.45 * temp_pressure + 0.275 * vib_pressure + 0.275 * em_pressure

    dT1 = rng.normal(0.0, 0.25) - 0.9 * pressure
    dT2 = rng.normal(0.0, 0.20) - 0.7 * pressure

    s.T1_us = clamp(s.T1_us + dT1, 20.0, 140.0)
    s.T2_us = clamp(s.T2_us + dT2, 12.0, min(120.0, s.T1_us * 0.95))

    s.p1q = clamp(s.p1q * (1.0 + 0.02 * pressure) + rng.normal(0, 0.00003), 0.0002, 0.006)
    s.p2q = clamp(s.p2q * (1.0 + 0.03 * pressure) + rng.normal(0, 0.00018), 0.001, 0.06)

    s.p0to1 = clamp(s.p0to1 * (1.0 + 0.04 * (vib_pressure + em_pressure)) + rng.normal(0, 0.0002), 0.002, 0.12)
    s.p1to0 = clamp(s.p1to0 * (1.0 + 0.04 * (vib_pressure + em_pressure)) + rng.normal(0, 0.0002), 0.002, 0.12)

    return s

def build_noise_model(s: HWState) -> NoiseModel:
    noise = NoiseModel()

    gate_time_1q = 0.05
    gate_time_2q = 0.25

    tr_1q = thermal_relaxation_error(s.T1_us, s.T2_us, gate_time_1q)
    tr_2q = thermal_relaxation_error(s.T1_us, s.T2_us, gate_time_2q)

    dep1 = depolarizing_error(s.p1q, 1)
    dep2 = depolarizing_error(s.p2q, 2)

    err_1q = tr_1q.compose(dep1)
    err_2q = tr_2q.compose(dep2)

    for g in ["x", "sx", "rz", "h"]:
        noise.add_all_qubit_quantum_error(err_1q, g)

    noise.add_all_qubit_quantum_error(err_2q, "cx")

    ro = ReadoutError([[1.0 - s.p0to1, s.p0to1], [s.p1to0, 1.0 - s.p1to0]])
    noise.add_all_qubit_readout_error(ro)

    return noise

def run_counts(sim: AerSimulator, qc: QuantumCircuit, shots: int) -> Dict[str, int]:
    job = sim.run(qc, shots=shots)
    result = job.result()
    return result.get_counts(0)


def estimate_readout_error(sim: AerSimulator, shots: int = 2000) -> float:
    qc0 = QuantumCircuit(1, 1)
    qc0.measure(0, 0)

    qc1 = QuantumCircuit(1, 1)
    qc1.x(0)
    qc1.measure(0, 0)

    c0 = run_counts(sim, qc0, shots)
    c1 = run_counts(sim, qc1, shots)

    p0_meas1 = c0.get("1", 0) / shots
    p1_meas0 = c1.get("0", 0) / shots
    return 100.0 * 0.5 * (p0_meas1 + p1_meas0)


def estimate_T1(sim: AerSimulator, taus_us: np.ndarray, shots: int = 1500) -> float:
    probs1 = []
    for tau in taus_us:
        qc = QuantumCircuit(1, 1)
        qc.x(0)

        N = max(1, int(round(tau / 0.5)))
        for _ in range(N):
            qc.id(0)

        qc.measure(0, 0)
        counts = run_counts(sim, qc, shots)
        p1 = counts.get("1", 0) / shots
        probs1.append(p1)

    y = np.array(probs1)

    p0 = [max(1e-3, y[0] - y[-1]), max(10.0, float(np.median(taus_us))), y[-1]]
    try:
        popt, _ = curve_fit(exp_decay, taus_us, y, p0=p0, maxfev=5000)
        T1 = float(abs(popt[1]))
    except Exception:
        T1 = float(np.nan)

    return T1


def estimate_T2_ramsey(sim: AerSimulator, taus_us: np.ndarray, shots: int = 1500) -> float:
    w = 2 * math.pi * 0.06
    probs0 = []
    for tau in taus_us:
        qc = QuantumCircuit(1, 1)
        qc.h(0)

        N = max(1, int(round(tau / 0.5)))
        for _ in range(N):
            qc.id(0)

        qc.rz(w * tau, 0)
        qc.h(0)
        qc.measure(0, 0)

        counts = run_counts(sim, qc, shots)
        p0 = counts.get("0", 0) / shots
        probs0.append(p0)

    y = np.array(probs0)

    a0 = (y.max() - y.min()) / 2
    c0 = y.mean()
    T20 = max(10.0, float(np.median(taus_us)))
    w0 = w
    phi0 = 0.0
    p0 = [a0, T20, w0, phi0, c0]

    try:
        popt, _ = curve_fit(damped_cos, taus_us, y, p0=p0, maxfev=8000)
        T2 = float(abs(popt[1]))
    except Exception:
        T2 = float(np.nan)

    return T2


def estimate_rb_fidelity_1q(sim: AerSimulator, depths: np.ndarray, shots: int = 1000) -> float:
    rng = np.random.default_rng(12345)

    def rand_1q_layer(qc: QuantumCircuit):
        r = rng.integers(0, 5)
        if r == 0:
            qc.h(0)
        elif r == 1:
            qc.s(0)
        elif r == 2:
            qc.x(0)
        elif r == 3:
            qc.sx(0)
        else:
            qc.rz(float(rng.normal(0, 1.0)), 0)

    surv = []
    for m in depths:
        reps = 12
        p0s = []
        for _ in range(reps):
            qc = QuantumCircuit(1, 1)
            for _ in range(int(m)):
                rand_1q_layer(qc)
            qc.measure(0, 0)
            counts = run_counts(sim, qc, shots)
            p0s.append(counts.get("0", 0) / shots)
        surv.append(float(np.mean(p0s)))

    y = np.array(surv)

    def rb_model(m, A, p, B):
        return A * (p ** m) + B

    p0 = [0.5, 0.995, 0.5]
    try:
        popt, _ = curve_fit(rb_model, depths, y, p0=p0, bounds=([-1, 0, -1], [2, 1, 2]), maxfev=8000)
        p = float(popt[1])
        F = 1.0 - (1.0 - p) / 2.0
        return 100.0 * F
    except Exception:
        return float(np.nan)


def estimate_rb_fidelity_2q(sim: AerSimulator, depths: np.ndarray, shots: int = 800) -> float:
    rng = np.random.default_rng(54321)

    def rand_layer(qc: QuantumCircuit):
        for q in [0, 1]:
            r = rng.integers(0, 4)
            if r == 0:
                qc.h(q)
            elif r == 1:
                qc.sx(q)
            elif r == 2:
                qc.x(q)
            else:
                qc.rz(float(rng.normal(0, 1.0)), q)
        if rng.random() < 0.55:
            qc.cx(0, 1)

    surv = []
    for m in depths:
        reps = 10
        p00s = []
        for _ in range(reps):
            qc = QuantumCircuit(2, 2)
            for _ in range(int(m)):
                rand_layer(qc)
            qc.measure([0, 1], [0, 1])
            counts = run_counts(sim, qc, shots)
            p00s.append(counts.get("00", 0) / shots)
        surv.append(float(np.mean(p00s)))

    y = np.array(surv)

    def rb_model(m, A, p, B):
        return A * (p ** m) + B

    p0 = [0.5, 0.99, 0.25]
    try:
        popt, _ = curve_fit(rb_model, depths, y, p0=p0, bounds=([-1, 0, -1], [2, 1, 2]), maxfev=8000)
        p = float(popt[1])
        F = 1.0 - 0.75 * (1.0 - p)
        return 100.0 * F
    except Exception:
        return float(np.nan)

app = FastAPI()
state = init_state()

def make_point(s: HWState) -> Dict:
    noise = build_noise_model(s)
    sim = AerSimulator(noise_model=noise)

    taus = np.array([0.5, 1.0, 2.0, 4.0, 7.0, 10.0, 14.0, 18.0, 24.0, 30.0], dtype=float)

    d1 = np.array([1, 2, 4, 8, 12, 16, 20], dtype=float)
    d2 = np.array([1, 2, 3, 4, 6, 8, 10], dtype=float)

    t1 = estimate_T1(sim, taus, shots=1200)
    t2 = estimate_T2_ramsey(sim, taus, shots=1200)
    readout = estimate_readout_error(sim, shots=2000)
    f1 = estimate_rb_fidelity_1q(sim, d1, shots=900)
    f2 = estimate_rb_fidelity_2q(sim, d2, shots=700)

    now_ms = int(time.time() * 1000)
    label = time.strftime("%H:%M:%S")

    if not np.isfinite(t1):
        t1 = s.T1_us
    if not np.isfinite(t2):
        t2 = s.T2_us
    if not np.isfinite(f1):
        f1 = 100.0 * (1.0 - s.p1q)
    if not np.isfinite(f2):
        f2 = 100.0 * (1.0 - s.p2q)

    t1 = float(clamp(t1, 18.0, 140.0))
    t2 = float(clamp(t2, 12.0, 120.0))
    f1 = float(clamp(f1, 98.0, 99.99))
    f2 = float(clamp(f2, 95.0, 99.95))
    readout = float(clamp(readout, 0.1, 12.0))

    return {
        "ts": now_ms,
        "label": label,
        "t1": t1,
        "t2": t2,
        "gate1q": f1,
        "gate2q": f2,
        "readout": readout,
        "temp": float(s.temp_K),
        "vibration": float(s.vibration),
        "em": float(s.em),
    }


@app.get("/stream")
def stream():
    def event_gen():
        global state
        while True:
            state = step_state(state, dt_s=2.0)
            point = make_point(state)
            payload = json.dumps(point)
            yield f"data: {payload}\n\n"
            time.sleep(2.0)

    return StreamingResponse(event_gen(), media_type="text/event-stream")
