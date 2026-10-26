/**
 * Numerical integrators.
 *
 * Two explicit methods are implemented:
 *  - Classical fixed-step RK4 (order 4). Deterministic, so repeatability and
 *    step-refinement convergence can be measured directly.
 *  - Dormand–Prince 5(4) with an embedded 4th-order error estimate and adaptive
 *    step-size control (FSAL). Used as an independent cross-check of RK4.
 *
 * Neither method is symplectic. Energy and angular momentum are therefore not
 * conserved exactly; their measured drift is a reported diagnostic, not an
 * assumption. A symplectic method is NOT implemented.
 */

export type DerivFunc = (t: number, y: Float64Array, dydt: Float64Array) => void;

export class IntegrationError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "IntegrationError";
  }
}

/** One classical RK4 step. Returns a new state array. */
export function rk4Step(f: DerivFunc, t: number, y: Float64Array, h: number): Float64Array {
  const n = y.length;
  const k1 = new Float64Array(n);
  const k2 = new Float64Array(n);
  const k3 = new Float64Array(n);
  const k4 = new Float64Array(n);
  const tmp = new Float64Array(n);

  f(t, y, k1);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k1[i];
  f(t + 0.5 * h, tmp, k2);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + 0.5 * h * k2[i];
  f(t + 0.5 * h, tmp, k3);
  for (let i = 0; i < n; i++) tmp[i] = y[i] + h * k3[i];
  f(t + h, tmp, k4);

  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = y[i] + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return out;
}

export interface RK4Options {
  stepS: number;
  maxSteps: number;
  /** Callback invoked after each step with the accepted state and time. */
  onSample?: (t: number, y: Float64Array) => void;
}

export function integrateRK4(
  f: DerivFunc,
  y0: Float64Array,
  durationS: number,
  opts: RK4Options,
): { steps: number; finalTime: number } {
  const { stepS, maxSteps } = opts;
  if (!(stepS > 0) || !Number.isFinite(stepS)) {
    throw new IntegrationError("INVALID_STEP", `RK4 step must be finite and > 0; received ${stepS}.`);
  }
  let y: Float64Array = new Float64Array(y0);
  let t = 0;
  let steps = 0;
  while (t < durationS) {
    if (steps >= maxSteps) {
      throw new IntegrationError(
        "STEP_LIMIT_EXCEEDED",
        `RK4 required more than ${maxSteps} steps; reduce the duration or increase the step size.`,
      );
    }
    // Final step is clipped so the propagated duration is exact.
    const h = Math.min(stepS, durationS - t);
    y = rk4Step(f, t, y, h);
    t += h;
    steps++;
    if (Number.isNaN(y[0]) || !Number.isFinite(y[0])) {
      throw new IntegrationError(
        "NUMERICAL_OVERFLOW",
        `Integration produced a non-finite state at t = ${t} s.`,
      );
    }
    opts.onSample?.(t, y);
  }
  return { steps, finalTime: t };
}

// Dormand–Prince 5(4) Butcher tableau.
const C = [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1];
const A: number[][] = [
  [],
  [1 / 5],
  [3 / 40, 9 / 40],
  [44 / 45, -56 / 15, 32 / 9],
  [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729],
  [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656],
  [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84],
];
const B5 = [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84, 0];
const B4 = [
  5179 / 57600, 0, 7571 / 16695, 393 / 640, -92097 / 339200, 187 / 2100, 1 / 40,
];

export interface DOPRI5Options {
  relTol: number;
  absTol: number;
  initialStepS: number;
  maxStepS: number;
  minStepS: number;
  maxSteps: number;
  onSample?: (t: number, y: Float64Array) => void;
}

export interface DOPRI5Stats {
  steps: number;
  accepted: number;
  rejected: number;
  finalTime: number;
  finalStepS: number;
}

/**
 * Adaptive Dormand–Prince 5(4). Samples are emitted at accepted steps only; the
 * final state lands exactly on `durationS` because the last step is clipped.
 */
export function integrateDOPRI5(
  f: DerivFunc,
  y0: Float64Array,
  durationS: number,
  opts: DOPRI5Options,
): DOPRI5Stats {
  const n = y0.length;
  let y = new Float64Array(y0);
  let t = 0;
  let h = opts.initialStepS;
  let steps = 0;
  let accepted = 0;
  let rejected = 0;

  const k = Array.from({ length: 7 }, () => new Float64Array(n));
  const ytmp = new Float64Array(n);
  const y5 = new Float64Array(n);

  while (t < durationS) {
    if (steps >= opts.maxSteps) {
      throw new IntegrationError(
        "STEP_LIMIT_EXCEEDED",
        `DOPRI5 required more than ${opts.maxSteps} attempted steps.`,
      );
    }
    const remaining = durationS - t;
    h = Math.min(h, opts.maxStepS, remaining);
    if (h < opts.minStepS) {
      throw new IntegrationError(
        "STEP_SIZE_UNDERFLOW",
        `Adaptive step size fell below the minimum (${opts.minStepS} s) at t = ${t} s; the requested tolerance cannot be met.`,
      );
    }

    f(t, y, k[0]);
    for (let s = 1; s < 7; s++) {
      for (let i = 0; i < n; i++) {
        let acc = 0;
        for (let j = 0; j < s; j++) acc += A[s][j] * k[j][i];
        ytmp[i] = y[i] + h * acc;
      }
      f(t + C[s] * h, ytmp, k[s]);
    }
    for (let i = 0; i < n; i++) {
      let acc5 = 0;
      let acc4 = 0;
      for (let j = 0; j < 7; j++) {
        acc5 += B5[j] * k[j][i];
        acc4 += B4[j] * k[j][i];
      }
      y5[i] = y[i] + h * acc5;
      ytmp[i] = h * (acc5 - acc4); // error estimate
    }

    let errNorm = 0;
    for (let i = 0; i < n; i++) {
      const sc = opts.absTol + opts.relTol * Math.max(Math.abs(y[i]), Math.abs(y5[i]));
      errNorm = Math.max(errNorm, Math.abs(ytmp[i]) / sc);
    }
    steps++;

    if (errNorm <= 1) {
      t += h;
      y.set(y5);
      accepted++;
      if (Number.isNaN(y[0]) || !Number.isFinite(y[0])) {
        throw new IntegrationError(
          "NUMERICAL_OVERFLOW",
          `Adaptive integration produced a non-finite state at t = ${t} s.`,
        );
      }
      opts.onSample?.(t, y);
      // Standard PI-free step control: exponent 1/5 for a 5(4) pair.
      const grow = errNorm === 0 ? 5 : 0.9 * Math.pow(errNorm, -0.2);
      h = h * Math.min(Math.max(grow, 0.2), 5);
    } else {
      rejected++;
      const shrink = Math.max(0.9 * Math.pow(errNorm, -0.2), 0.1);
      h = h * shrink;
    }
  }

  return { steps, accepted, rejected, finalTime: t, finalStepS: h };
}
