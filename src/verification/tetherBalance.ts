/**
 * Energy-balance identity for the VARIABLE-LENGTH libration equation.
 *
 * Equation (documented form, constant n, prescribed length L(t) = L0 + Ldot t):
 *
 *     theta'' + 2 (Ldot/L) theta' + 3 n^2 sin(theta) cos(theta) = 0
 *
 * Derivation of the identity
 * --------------------------
 * Define the libration "energy"
 *
 *     K = theta'^2 / 2 - (3/2) n^2 cos^2(theta).
 *
 * Differentiating along any smooth path,
 *
 *     dK/dt = theta' (theta'' + 3 n^2 sin(theta) cos(theta)),
 *
 * because d/dt[-3/2 n^2 cos^2] = 3 n^2 sin(theta) cos(theta) theta'.
 * Substituting the equation for theta'' gives, for every solution,
 *
 *     dK/dt = -2 (Ldot/L) theta'^2,
 *
 * and hence, for any t,
 *
 *     K(t) - K(0) = -2 \int_0^t (Ldot/L) theta'^2 dt.          (BALANCE)
 *
 * Consequences that are checked rather than assumed:
 *
 *  - Ldot = 0 (constant length): the right-hand side is zero, so K is exactly
 *    invariant. This is the constant-length statement, and it is the same K used by
 *    the existing OT-TT-009 and OT-TT-015 checks.
 *  - Ldot > 0 with L increasing: Ldot/L > 0, so dK/dt <= 0. K must decrease, and the
 *    decrease must equal the accumulated integral. There is no cancellation that could
 *    make this hold accidentally for a wrong coefficient.
 *
 * What is NOT true, and is not claimed here
 * -----------------------------------------
 * L^4 K is not conserved in general. Multiplying by L^4 gives
 *
 *     d(L^4 K)/dt = 4 L^3 Ldot K - 2 L^3 Ldot theta'^2,
 *
 * which does not vanish unless K = theta'^2/2, i.e. only in the singular case
 * cos(theta) = 0. A test below measures the drift of L^4 K to show that it is not an
 * invariant of this equation, so the application cannot quietly present it as one. No
 * conservation claim is made for the tether subsystem: length is prescribed, work is
 * done on the system by whatever mechanism enforces that prescription, and this module
 * deliberately does not model that mechanism.
 *
 * What this verifies, and what it does not
 * ---------------------------------------
 * It verifies that the implemented variable-length equation satisfies its own balance
 * identity, that an independent quadrature reproduces the analytic integral on a
 * manufactured exact solution, and that the residual along a numerical trajectory is
 * explained by truncation rather than by a missing term. It does NOT validate the
 * deployment mechanism: reel dynamics, actuator torque, tether elasticity, damping,
 * out-of-plane motion and comparison with flight data are separate questions, and none
 * of them is addressed by an identity that follows from the equation itself.
 *
 * Categories used throughout
 * --------------------------
 *  ANALYTIC IDENTITY          - true by algebra for every solution of the equation.
 *  INDEPENDENT NUMERICAL CHECK- a different code path (quadrature, separate integrator,
 *                               manufactured solution) confirms the identity numerically.
 *  EMPIRICAL COMPARISON       - a measured residual is compared with a measured error
 *                               budget; it is evidence, not a proof.
 */

export interface LibrationSample {
  t: number;
  theta: number;
  thetaDot: number;
}

/**
 * Prescribed length history L(t) with its exact logarithmic gradient Ldot/L.
 *
 * Both come from a closed form; nothing is differentiated numerically, so a nonlinear
 * history is specified independently of the integrator that consumes it. Supplying a
 * history overrides the linear pair (length0M, rateMS); the linear pair stays the
 * default so the earlier linear cases are unchanged.
 */
export interface LengthHistory {
  label: string;
  /** L(t) in metres, strictly positive over the run. */
  at(t: number): number;
  /** Ldot(t)/L(t), 1/s, exactly. */
  logGradient(t: number): number;
}

/** L(t) = L0 + rate t. */
export function linearLength(length0M: number, rateMS: number): LengthHistory {
  return {
    label: `linear ${length0M} m + ${rateMS} m/s`,
    at: (t) => length0M + rateMS * t,
    logGradient: (t) => {
      const L = length0M + rateMS * t;
      if (!(L > 0)) throw new Error("linearLength: prescribed length is not positive.");
      return rateMS / L;
    },
  };
}

/** L(t) = L0 exp(c t), so Ldot/L = c exactly, constant in time. */
export function exponentialLength(length0M: number, cPerS: number): LengthHistory {
  return {
    label: `exponential ${length0M} m, Ldot/L = ${cPerS} 1/s`,
    at: (t) => length0M * Math.exp(cPerS * t),
    logGradient: () => cPerS,
  };
}

/** L(t) = L0 + a t + b t^2, so Ldot/L = (a + 2 b t) / L. */
export function quadraticLength(length0M: number, aMS: number, bMS2: number): LengthHistory {
  const at = (t: number) => length0M + aMS * t + bMS2 * t * t;
  return {
    label: `quadratic ${length0M} m + ${aMS} m/s + ${bMS2} m/s^2`,
    at,
    logGradient: (t) => {
      const L = at(t);
      if (!(L > 0)) throw new Error("quadraticLength: prescribed length is not positive.");
      return (aMS + 2 * bMS2 * t) / L;
    },
  };
}

/** L(t) = L0 + A (1 - cos(omega t)); Ldot/L = A omega sin(omega t) / L. */
export function sinusoidalLength(length0M: number, amplitudeM: number, omegaPerS: number): LengthHistory {
  if (!(length0M > 2 * Math.abs(amplitudeM))) {
    throw new Error("sinusoidalLength: amplitude must keep the prescribed length positive.");
  }
  const at = (t: number) => length0M + amplitudeM * (1 - Math.cos(omegaPerS * t));
  return {
    label: `sinusoidal ${length0M} m + ${amplitudeM} m (1 - cos ${omegaPerS} t)`,
    at,
    logGradient: (t) => (amplitudeM * omegaPerS * Math.sin(omegaPerS * t)) / at(t),
  };
}

export interface BalanceOptions {
  /** Constant mean motion of the equation, rad/s. */
  nRadS: number;
  /** Prescribed length at t = 0, metres. */
  length0M: number;
  /** Prescribed length rate, m/s. Non-negative in the model. Ignored when `length` is given. */
  rateMS: number;
  /** Optional nonlinear length history; overrides the linear pair above. */
  length?: LengthHistory;
}

/** Resolve the length history for an option set (the linear pair when none is supplied). */
export function lengthHistoryOf(opts: BalanceOptions): LengthHistory {
  return opts.length ?? linearLength(opts.length0M, opts.rateMS);
}

/** K = theta'^2/2 - (3/2) n^2 cos^2(theta). Rad^2/s^2. */
export function librationK(theta: number, thetaDot: number, n: number): number {
  return (thetaDot * thetaDot) / 2 - 1.5 * n * n * Math.cos(theta) ** 2;
}

/** (Ldot/L) at time t, 1/s. Implemented here, not imported from the production RHS. */
export function logLengthGradient(
  t: number,
  length0M: number,
  rateMS: number,
  length?: LengthHistory,
): number {
  if (length) return length.logGradient(t);
  const L = length0M + rateMS * t;
  if (!(L > 0)) throw new Error("logLengthGradient: prescribed length is not positive.");
  return rateMS / L;
}

/** Integrand of the balance identity: 2 (Ldot/L) theta'^2, rad^2/s^3. */
export function balanceIntegrand(
  thetaDot: number,
  t: number,
  length0M: number,
  rateMS: number,
  length?: LengthHistory,
): number {
  return 2 * logLengthGradient(t, length0M, rateMS, length) * thetaDot * thetaDot;
}

/**
 * Composite Simpson over samples with uniform spacing h.
 *
 * Written out here so the quadrature shares no code with the integrator or with the
 * right-hand side it is checking. An odd number of intervals is handled by applying
 * Simpson's 3/8 rule to the final three and Simpson's 1/3 rule to the rest, so the
 * routine accepts any sample count >= 3 and never silently changes the interval it
 * integrates over.
 */
export function compositeSimpson(values: readonly number[], h: number): number {
  const n = values.length - 1;
  if (n < 2) throw new Error(`compositeSimpson needs at least 3 samples, received ${values.length}.`);
  const intervals = n % 2 === 0 ? n : n - 3;
  let sum = values[0] + values[intervals];
  for (let i = 1; i < intervals; i++) sum += (i % 2 === 1 ? 4 : 2) * values[i];
  let total = (h / 3) * sum;
  if (intervals < n) {
    // Simpson 3/8 over [t_{n-3}, t_n].
    total +=
      ((3 * h) / 8) * (values[n - 3] + 3 * values[n - 2] + 3 * values[n - 1] + values[n]);
  }
  return total;
}

export interface QuadratureResult {
  /** Simpson on the full sample set. */
  value: number;
  /** Simpson on every second sample: the same integral at twice the spacing. */
  coarse: number;
  /**
   * Richardson estimate of the fine quadrature's own error: for a fourth-order rule,
   * I - Q(h) ~ (Q(h) - Q(2h)) / 15. Reported as a magnitude.
   */
  richardsonError: number;
  /** Observed order of the quadrature from three spacings; null if not computable. */
  observedOrder: number | null;
}

/**
 * Integrate a sampled integrand with Simpson, and estimate the quadrature error without
 * knowing the exact integral: compare with the same rule at twice the spacing, and (with
 * enough samples) fit the order from three spacings. `h` is the spacing of `values`.
 * All three rules cover the same interval, so the comparison is like for like.
 */
export function quadratureWithEstimate(values: readonly number[], h: number): QuadratureResult {
  const fine = compositeSimpson(values, h);
  const everyOther = values.filter((_, i) => i % 2 === 0);
  const coarse = compositeSimpson(everyOther, 2 * h);
  const everyFourth = everyOther.filter((_, i) => i % 2 === 0);
  const veryCoarse = everyFourth.length >= 3 ? compositeSimpson(everyFourth, 4 * h) : null;
  const richardsonError = Math.abs(fine - coarse) / 15;
  const observedOrder =
    veryCoarse === null
      ? null
      : coarse - veryCoarse !== 0 && fine - coarse !== 0
        ? Math.log2(Math.abs(coarse - veryCoarse) / Math.abs(fine - coarse))
        : null;
  return { value: fine, coarse, richardsonError, observedOrder };
}

export interface BalancePoint {
  timeS: number;
  /** K(t) - K(0) along the sampled trajectory, rad^2/s^2. */
  deltaK: number;
  /** 2 \int_0^t (Ldot/L) theta'^2 dt, rad^2/s^2 (non-negative for rate >= 0). */
  integral: number;
  /** deltaK + integral: zero for an exact solution of the equation. */
  residual: number;
  /** |residual| / |deltaK|; null when deltaK is zero (constant length). */
  relativeResidual: number | null;
  /** |residual| / |K(0)|; always defined and scale-free. */
  residualOverInitialK: number;
  quadratureError: number;
}

/**
 * Evaluate the balance identity along a sampled trajectory at selected times. The
 * integral is accumulated from t = 0 to each reporting time with composite Simpson on
 * the recorded samples, so intermediate times are checked, not only the final one.
 *
 * The samples must be uniformly spaced and start at t = 0; each reporting time is
 * chosen at an even sample index so the Simpson rule is well defined over [0, t].
 */
export function balanceAlong(
  samples: readonly LibrationSample[],
  opts: BalanceOptions & { fractions?: number[] },
): BalancePoint[] {
  const fractions = opts.fractions ?? [0.25, 0.5, 0.75, 1];
  if (samples.length < 5) throw new Error("balanceAlong needs at least five samples.");
  const h = samples[1].t - samples[0].t;
  if (!(h > 0)) throw new Error("balanceAlong requires strictly increasing sample times.");
  for (let i = 1; i < samples.length; i++) {
    if (Math.abs(samples[i].t - samples[i - 1].t - h) > 1e-9 * h) {
      throw new Error("balanceAlong requires uniformly spaced samples.");
    }
  }
  const k0 = librationK(samples[0].theta, samples[0].thetaDot, opts.nRadS);
  const full = samples.length - 1; // number of intervals

  return fractions.map((f) => {
    // At least four intervals are needed for the half-spacing comparison that estimates the
    // quadrature error, so an early reporting fraction on a short run is moved forward to
    // the first index where that estimate exists. The reported time is the actual one.
    const target = Math.max(4, Math.min(full, Math.round(full * f)));
    const slice = samples.slice(0, target + 1);
    const integrand = slice.map((s) =>
      balanceIntegrand(s.thetaDot, s.t, opts.length0M, opts.rateMS, opts.length),
    );
    const q = quadratureWithEstimate(integrand, h);
    const last = slice[slice.length - 1];
    const deltaK = librationK(last.theta, last.thetaDot, opts.nRadS) - k0;
    const residual = deltaK + q.value;
    return {
      timeS: last.t,
      deltaK,
      integral: q.value,
      residual,
      relativeResidual: deltaK === 0 ? null : Math.abs(residual) / Math.abs(deltaK),
      residualOverInitialK: Math.abs(residual) / Math.abs(k0),
      quadratureError: q.richardsonError,
    };
  });
}

/**
 * Manufactured exact solution of the variable-length equation.
 *
 * Take theta(t) = theta0 + a t with theta'' = 0. The equation then requires
 *
 *     Ldot/L = -3 n^2 sin(theta) cos(theta) / (2a),
 *
 * which integrates in closed form to
 *
 *     L(t) = L0 exp{ (3 n^2 / (8 a^2)) [cos(2 theta(t)) - cos(2 theta0)] }.
 *
 * Along that trajectory theta, theta', L, K and the balance integral are all available
 * analytically:
 *
 *     Delta K(t) = (3/2) n^2 [cos^2(theta0) - cos^2(theta(t))]
 *     J(t) = -Delta K(t)
 *
 * This gives the quadrature an exact answer with no ODE integration in the loop, which
 * is what separates quadrature error from integration error.
 */
export interface ManufacturedPoint {
  t: number;
  theta: number;
  thetaDot: number;
  lengthM: number;
  /**
   * (Ldot/L) implied by the equation for this theta(t): -3 n^2 sin(theta)cos(theta) / (2a).
   * Exact by construction, so the integrand needs no numerical differentiation.
   */
  logGradient: number;
  K: number;
  deltaK: number;
  /** Exact value of 2 \int_0^t (Ldot/L) theta'^2 dt. */
  exactIntegral: number;
}

export function manufacturedSolution(
  theta0Rad: number,
  angularDriftRadPerS: number,
  nRadS: number,
  length0M: number,
  durationS: number,
  samples: number,
): ManufacturedPoint[] {
  if (!(angularDriftRadPerS !== 0)) throw new Error("manufacturedSolution needs a nonzero angular drift.");
  if (!(samples >= 5) || samples % 2 === 0) throw new Error("manufacturedSolution needs an odd sample count >= 5.");
  const coef = (3 * nRadS * nRadS) / (8 * angularDriftRadPerS * angularDriftRadPerS);
  const thetaAt = (t: number): number => theta0Rad + angularDriftRadPerS * t;
  const lengthAt = (t: number): number =>
    length0M * Math.exp(coef * (Math.cos(2 * thetaAt(t)) - Math.cos(2 * theta0Rad)));
  const k0 = librationK(theta0Rad, angularDriftRadPerS, nRadS);
  const out: ManufacturedPoint[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / (samples - 1)) * durationS;
    const theta = thetaAt(t);
    const K = librationK(theta, angularDriftRadPerS, nRadS);
    out.push({
      t,
      theta,
      thetaDot: angularDriftRadPerS,
      lengthM: lengthAt(t),
      logGradient: (-3 * nRadS * nRadS * Math.sin(theta) * Math.cos(theta)) / (2 * angularDriftRadPerS),
      K,
      deltaK: K - k0,
      exactIntegral: 1.5 * nRadS * nRadS * (Math.cos(theta) ** 2 - Math.cos(theta0Rad) ** 2),
    });
  }
  return out;
}

export interface PrescribedIntegration {
  samples: LibrationSample[];
  steps: number;
  stepS: number;
}

/**
 * Independent fixed-step RK4 for the documented variable-length equation at constant n.
 *
 * Deliberately separate from the production right-hand side: the production engine
 * couples the libration to an integrated orbit, which changes n(t). Here n is the exact
 * constant of the equation whose identity is being checked. The equivalence of this
 * expression to the production libration row is asserted separately, over a full run,
 * so the identity is tied to the code that ships.
 */
export function integratePrescribed(
  opts: BalanceOptions & { theta0Rad: number; thetaDot0RadPerS: number; durationS: number; stepS: number },
): PrescribedIntegration {
  const { nRadS: n, theta0Rad, thetaDot0RadPerS, durationS, stepS } = opts;
  if (!(stepS > 0) || !(durationS > 0)) throw new Error("integratePrescribed: duration and step must be positive.");
  const steps = Math.round(durationS / stepS);
  if (steps < 2) throw new Error("integratePrescribed needs at least two steps.");
  const h = durationS / steps;
  const length = lengthHistoryOf(opts);
  // L > 0 over the whole run is a precondition of the equation, checked at both ends.
  if (!(length.at(0) > 0) || !(length.at(durationS) > 0)) {
    throw new Error("integratePrescribed: the prescribed length must stay positive.");
  }
  const f = (t: number, theta: number, thetaDot: number): [number, number] => [
    thetaDot,
    -3 * n * n * Math.sin(theta) * Math.cos(theta) - 2 * length.logGradient(t) * thetaDot,
  ];
  const samples: LibrationSample[] = [{ t: 0, theta: theta0Rad, thetaDot: thetaDot0RadPerS }];
  let theta = theta0Rad;
  let thetaDot = thetaDot0RadPerS;
  let t = 0;
  for (let i = 0; i < steps; i++) {
    const k1 = f(t, theta, thetaDot);
    const k2 = f(t + h / 2, theta + (h / 2) * k1[0], thetaDot + (h / 2) * k1[1]);
    const k3 = f(t + h / 2, theta + (h / 2) * k2[0], thetaDot + (h / 2) * k2[1]);
    const k4 = f(t + h, theta + h * k3[0], thetaDot + h * k3[1]);
    theta += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    thetaDot += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    t += h;
    samples.push({ t, theta, thetaDot });
  }
  return { samples, steps, stepS: h };
}

/** L^4 K, reported only to show that it is NOT an invariant of this equation. */
export function scaledInvariant(
  sample: LibrationSample,
  n: number,
  length0M: number,
  rateMS: number,
  length?: LengthHistory,
): number {
  const L = length ? length.at(sample.t) : length0M + rateMS * sample.t;
  return L ** 4 * librationK(sample.theta, sample.thetaDot, n);
}

export interface ErrorBudget {
  /** |theta'|max * epsThetaDot + 3 n^2 epsTheta: propagation of trajectory error through K. */
  kTerm: number;
  /** 4 (Ldot/L)max |theta'|max T epsThetaDot: propagation through the integral. */
  integralTerm: number;
  /** Richardson estimate of the quadrature error at the reporting time. */
  quadratureTerm: number;
  /** 4 * (kTerm + integralTerm + quadratureTerm). */
  total: number;
  safetyFactor: number;
}

/**
 * Error budget for the measured balance residual.
 *
 * The residual is built from two numerically estimated quantities:
 *
 *   deltaK  has partial derivatives dK/dtheta = 3 n^2 sin(theta)cos(theta) and
 *            dK/dtheta' = theta', so a trajectory error (epsTheta, epsTheta') moves it by
 *            at most 3 n^2 epsTheta + |theta'|max epsTheta'.
 *   integral  has integrand 2 (Ldot/L) theta'^2, so the same trajectory error moves it by
 *            at most 4 (Ldot/L)max |theta'|max T epsTheta'.
 *
 * The trajectory error itself is MEASURED by self-convergence (the difference between
 * this run and a run at half the step), and the quadrature error is estimated by
 * Richardson. A factor of 4 is then applied and stated: eps measured this way is an
 * estimate rather than a strict bound, and the linearisation above neglects second-order
 * terms. The factor is declared here, not tuned to an observed residual.
 */
export function errorBudget(
  samples: readonly LibrationSample[],
  opts: BalanceOptions & { epsThetaRad: number; epsThetaDotRadPerS: number; quadratureTerm: number },
): ErrorBudget {
  const n = opts.nRadS;
  const durationS = samples[samples.length - 1].t;
  let maxThetaDot = 0;
  let maxGradient = 0;
  for (const s of samples) {
    maxThetaDot = Math.max(maxThetaDot, Math.abs(s.thetaDot));
    maxGradient = Math.max(maxGradient, logLengthGradient(s.t, opts.length0M, opts.rateMS, opts.length));
  }
  const kTerm = maxThetaDot * opts.epsThetaDotRadPerS + 3 * n * n * opts.epsThetaRad;
  const integralTerm = 4 * maxGradient * maxThetaDot * durationS * opts.epsThetaDotRadPerS;
  const safetyFactor = 4;
  return {
    kTerm,
    integralTerm,
    quadratureTerm: opts.quadratureTerm,
    total: safetyFactor * (kTerm + integralTerm + opts.quadratureTerm),
    safetyFactor,
  };
}

/**
 * Maximum absolute difference between two sampled trajectories at the same times.
 *
 * The second trajectory may be on a uniformly finer grid (stride 2, 3, ...); it is
 * sampled at the coarse times, which is what self-convergence needs. This compares two
 * solutions of the same equation, so the difference estimates the coarse run's error.
 */
export function trajectoryDifference(
  coarse: readonly LibrationSample[],
  fine: readonly LibrationSample[],
): { maxTheta: number; maxThetaDot: number; stride: number } {
  if (fine.length < coarse.length) throw new Error("trajectoryDifference expects the finer grid second.");
  const stride = (fine.length - 1) / (coarse.length - 1);
  if (!Number.isInteger(stride) || stride < 1) {
    throw new Error("trajectoryDifference requires one grid to be an integer refinement of the other.");
  }
  let maxTheta = 0;
  let maxThetaDot = 0;
  for (let i = 0; i < coarse.length; i++) {
    const f = fine[i * stride];
    maxTheta = Math.max(maxTheta, Math.abs(coarse[i].theta - f.theta));
    maxThetaDot = Math.max(maxThetaDot, Math.abs(coarse[i].thetaDot - f.thetaDot));
  }
  return { maxTheta, maxThetaDot, stride };
}

/* =====================================================================================
 * CALIBRATION MATRIX
 *
 * A single case cannot show that the error budget is conservative. This harness runs the
 * balance check over a matrix of initial amplitudes, prescribed lengths, deployment rates
 * and durations, at several integration steps, and reports the residual/budget ratio for
 * every (case, step, reporting time). The question it answers is whether the budget
 * methodology holds up across cases, not whether one case passes.
 *
 * Three outcomes, kept distinct on purpose:
 *
 *   PASS        every budgeted (case, step, time) has |residual| <= budget, and the
 *               residual falls at least at third order for every case.
 *   UNRESOLVED  the criterion cannot be justified for some case or (case, step, time):
 *               no budget is computable (no finer run, or a zero trajectory difference),
 *               or the residual exceeds its budget by up to 10x, which is within the
 *               range where a limitation of the ESTIMATE and a defect cannot be told
 *               apart. This is a statement about the evidence, not about the code.
 *   FAIL        a residual exceeds its budget by more than 10x. The baseline residual is
 *               four to five orders below budget, so a factor-10 overshoot is not
 *               explicable by the estimate's own uncertainty.
 *
 * The 10x threshold is declared here and is not fitted to any observed ratio.
 * ===================================================================================== */

export interface BalanceCaseSpec {
  caseId: string;
  description: string;
  theta0Deg: number;
  /** Initial angular rate; defaults to 0. Radians per second of the libration angle. */
  thetaDot0DegPerS?: number;
  length0M: number;
  /** Initial prescribed rate, m/s. Reported for every case; the history governs the run. */
  rateMS: number;
  durationS: number;
  /** Nonlinear prescribed length history; overrides (length0M, rateMS) when present. */
  length?: LengthHistory;
  /** Why the case is in the matrix. */
  regime: string;
}

/**
 * The matrix: initial amplitude, initial rate, prescribed length, deployment history,
 * rate and duration are varied.
 *
 * The first eight cases are the original calibration set (linear deployment, zero initial
 * rate). Cases BC-9 to BC-14 were added to test whether the criterion generalises beyond
 * the configurations used to calibrate it:
 *
 *   BC-9  exponential history, Ldot/L constant but nonzero: the deployment term is a
 *         pure damping with no time dependence, the cleanest nonlinear-history control.
 *   BC-10 sinusoidal history: Ldot changes sign, so the integral is not monotone and K
 *         rises as well as falls. A sign error cannot hide behind a monotone balance.
 *   BC-11 quadratic history: both Ldot and Ldot/L vary over the run.
 *   BC-12 nonzero positive initial rate: the trajectory starts away from the turning
 *         point, so the libration phase is not the trivial one.
 *   BC-13 nonzero negative initial rate at constant length: the integral is identically
 *         zero while K must stay constant, so a deployment-term error shows up directly.
 *   BC-14 small signal: 0.05 deg at 0.1 m/s, where |deltaK| is about five orders below
 *         |K|. This is the resolution case: the balance is nearly pure cancellation.
 */
export const BALANCE_CASES: BalanceCaseSpec[] = [
  {
    caseId: "BC-1",
    description: "TC-2 reference case: 2 deg, 20 km, 1 m/s, 6900 s",
    theta0Deg: 2,
    length0M: 20_000,
    rateMS: 1,
    durationS: 6900,
    regime: "linear deployment, zero initial rate",
  },
  {
    caseId: "BC-2",
    description: "constant length: 5 deg, 20 km, 0 m/s, 6900 s",
    theta0Deg: 5,
    length0M: 20_000,
    rateMS: 0,
    durationS: 6900,
    regime: "constant length, zero initial rate",
  },
  {
    caseId: "BC-3",
    description: "large amplitude: 30 deg, 20 km, 1 m/s, 6900 s",
    theta0Deg: 30,
    length0M: 20_000,
    rateMS: 1,
    durationS: 6900,
    regime: "large amplitude, linear deployment",
  },
  {
    caseId: "BC-4",
    description: "near the model amplitude limit: 60 deg, 20 km, 1 m/s",
    theta0Deg: 60,
    length0M: 20_000,
    rateMS: 1,
    durationS: 6900,
    regime: "amplitude near the small-angle limit, linear deployment",
  },
  {
    caseId: "BC-5",
    description: "fast deployment: 5 deg, 20 km, 5 m/s, 6900 s (L to 54.5 km)",
    theta0Deg: 5,
    length0M: 20_000,
    rateMS: 5,
    durationS: 6900,
    regime: "fast linear deployment",
  },
  {
    caseId: "BC-6",
    description: "slow deployment: 5 deg, 20 km, 0.1 m/s, 6900 s",
    theta0Deg: 5,
    length0M: 20_000,
    rateMS: 0.1,
    durationS: 6900,
    regime: "slow linear deployment",
  },
  {
    caseId: "BC-7",
    description: "short tether: 5 deg, 1 km, 1 m/s, 6900 s",
    theta0Deg: 5,
    length0M: 1000,
    rateMS: 1,
    durationS: 6900,
    regime: "short tether, large relative deployment",
  },
  {
    caseId: "BC-8",
    description: "short run: 5 deg, 20 km, 2 m/s, 1800 s",
    theta0Deg: 5,
    length0M: 20_000,
    rateMS: 2,
    durationS: 1800,
    regime: "short duration",
  },
  {
    caseId: "BC-9",
    description: "exponential history: 5 deg, 20 km x exp(1e-4 t), 6900 s",
    theta0Deg: 5,
    length0M: 20_000,
    rateMS: 2,
    durationS: 6900,
    length: exponentialLength(20_000, 1e-4),
    regime: "nonlinear history, constant Ldot/L",
  },
  {
    caseId: "BC-10",
    description: "sinusoidal history: 5 deg, 20 km + 2 km (1 - cos(2pi t / 2400 s))",
    theta0Deg: 5,
    length0M: 20_000,
    rateMS: 0,
    durationS: 6900,
    length: sinusoidalLength(20_000, 2000, (2 * Math.PI) / 2400),
    regime: "nonlinear history, alternating deployment and retrieval",
  },
  {
    caseId: "BC-11",
    description: "quadratic history: 5 deg, 20 km + 1 m/s t + 2e-4 m/s^2 t^2",
    theta0Deg: 5,
    length0M: 20_000,
    rateMS: 1,
    durationS: 6900,
    length: quadraticLength(20_000, 1, 2e-4),
    regime: "nonlinear history, varying Ldot/L",
  },
  {
    caseId: "BC-12",
    description: "nonzero initial rate: 5 deg, 2e-4 rad/s, 20 km, 1 m/s",
    theta0Deg: 5,
    thetaDot0DegPerS: (2e-4 * 180) / Math.PI,
    length0M: 20_000,
    rateMS: 1,
    durationS: 6900,
    regime: "nonzero positive initial rate",
  },
  {
    caseId: "BC-13",
    description: "constant length, negative initial rate: 10 deg, -2e-4 rad/s",
    theta0Deg: 10,
    thetaDot0DegPerS: (-2e-4 * 180) / Math.PI,
    length0M: 20_000,
    rateMS: 0,
    durationS: 6900,
    regime: "constant length, nonzero negative initial rate",
  },
  {
    caseId: "BC-14",
    description: "small signal: 0.05 deg, 20 km, 0.1 m/s, 6900 s",
    theta0Deg: 0.05,
    length0M: 20_000,
    rateMS: 0.1,
    durationS: 6900,
    regime: "small signal, balance is nearly pure cancellation",
  },
];

/** Reporting fractions: intermediate times, not only the end of the run. */
export const BALANCE_FRACTIONS = [0.1, 0.25, 0.5, 0.75, 0.9, 1];

/** Classification thresholds, declared once and not fitted to any observed ratio. */
export const BALANCE_CLASSIFICATION = {
  /** Above this multiple of the budget, no limitation of the estimate explains the gap. */
  failRatio: 10,
  /** Between 1 and this, the case is unresolved: the cause is undetermined. */
  cautionRatio: 1,
  /** Asymptotic residual order floor. An RK4 residual is fourth order. */
  minAsymptoticOrder: 3,
  /**
   * Heuristic screening criterion, not a general test of order reliability. Successive
   * asymptotic order estimates must agree within one order unit. Agreement does not prove
   * the asymptotic regime has been reached (two misleading estimates can agree), and
   * disagreement does not prove a defect. It only means the sequence has not settled, so
   * its apparent order is withheld from the verdict.
   */
  maxOrderSpread: 1,
  /**
   * |residual| / |J| above this means the quantity the identity balances (the accumulated
   * integral) is no larger than the discrepancy in it: the case has run out of resolution
   * and cannot support a verdict either way. Not applied when J is zero (constant length),
   * where the identity degenerates to K constant and the budget alone is the test.
   */
  maxResidualOverBalance: 1,
} as const;

export type BalanceStatus = "PASS" | "UNRESOLVED" | "FAIL";

/**
 * Why a case received its status. Statuses describe the stated numerical acceptance
 * criterion only. A low order can come from leaving the asymptotic regime, cancellation,
 * round-off or a defect, and a large residual can come from a defect or from the estimate
 * being wrong; neither identifies a cause on its own.
 */
export type BalanceDiagnosis =
  | "CRITERION_MET"
  | "BUDGET_NOT_COMPUTABLE"
  | "INVALID_RATIO"
  | "BALANCE_BELOW_RESOLUTION"
  | "BUDGET_EXCEEDED_BEYOND_10X"
  | "BUDGET_EXCEEDED_WITHIN_10X"
  | "ORDER_NOT_COMPUTABLE"
  | "ORDER_ESTIMATE_UNRELIABLE"
  | "ORDER_ROUND_OFF_LIMITED"
  | "ORDER_BELOW_FLOOR";

/** Shown wherever a status is shown, so FAIL is not read as a physics verdict. */
export const BALANCE_STATUS_MEANING =
  "Statuses refer to the stated numerical acceptance criterion, not to the physics. FAIL means the measured residual " +
  "violated that criterion; it does not establish that the documented equation or the model is wrong. UNRESOLVED means " +
  "the evidence cannot decide, which is not a pass.";

export interface BalanceCasePoint {
  stepS: number;
  timeS: number;
  residual: number;
  budget: number | null;
  ratio: number | null;
}

export interface BalanceCaseResult {
  caseId: string;
  description: string;
  regime: string;
  steps: number[];
  points: BalanceCasePoint[];
  /** Largest ratio over budgeted points; null if no point had a budget. */
  worstRatio: number | null;
  worstRatioWhere: { stepS: number; timeS: number } | null;
  finalResiduals: number[];
  /** residualOrders[i] is the order between steps i-1 and i; index 0 is the coarsest pair. */
  residualOrders: (number | null)[];
  /** Orders from the second pair onward, which is what the criterion uses. */
  asymptoticOrders: (number | null)[];
  /** max - min of the asymptotic orders; null when fewer than two are computable. */
  orderSpread: number | null;
  ordersReliable: boolean;
  /**
   * |residual| / |integral| at the finest step and final time: how large the discrepancy is
   * compared with the balance being tested. Null when the integral is zero.
   */
  residualOverIntegral: number | null;
  minAsymptoticOrder: number | null;
  maxAsymptoticOrder: number | null;
  quadratureOrderFinal: number | null;
  /**
   * Estimated double-precision floor for the residual:
   * eps * (|K|max + |J|) * sqrt(steps). The sqrt(steps) is the usual random-walk
   * accumulation of rounding over the number of samples differenced; it is an estimate
   * of the floor, not a bound.
   */
  roundOffFloor: number;
  l4Drift: number;
  /** Residuals at the finest step, which have no budget because no finer run exists. */
  unbudgetedResiduals: { stepS: number; timeS: number; residual: number }[];
  budgetedPoints: number;
  unbudgetedPoints: number;
  status: BalanceStatus;
  diagnosis: BalanceDiagnosis;
  reasons: string[];
}

export interface CalibrationResult {
  cases: BalanceCaseResult[];
  worstRatio: number | null;
  worstCaseId: string | null;
  status: BalanceStatus;
  casesPassing: number;
  casesUnresolved: number;
  casesFailing: number;
  reportingTimes: number;
  /** Budgeted (case, step, time) measurements. Not independent cases. */
  totalBudgetedPoints: number;
  /** Finest-step measurements, reported but not budgeted. */
  totalUnbudgetedPoints: number;
  /** Distinct configurations, i.e. the number of independent initial-value problems. */
  configurations: number;
}

/**
 * Classify one case. Order of the tests, and why:
 *
 *  1. no budget                 -> UNRESOLVED. The criterion has no denominator.
 *  2. balance below resolution  -> UNRESOLVED. The residual is as large as the quantity
 *                                  the identity balances, so the comparison is empty.
 *  3. ratio > 10                -> FAIL. Failure of the numerical acceptance criterion
 *                                  (the budget is empirical, not a bound). It does not
 *                                  establish that the equation or model is wrong.
 *  4. 1 < ratio <= 10           -> UNRESOLVED. Either the estimate is not conservative or
 *                                  there is a defect; the evidence cannot separate them.
 *  5. order not computable      -> UNRESOLVED.
 *  6. order estimates disagree  -> UNRESOLVED. No single order is established.
 *  7. order < 3                 -> UNRESOLVED. A low order is consistent with a defect,
 *                                  with leaving the asymptotic regime, with cancellation,
 *                                  or with round-off; it does not demonstrate a defect, so
 *                                  it is not a FAIL.
 *  8. otherwise                 -> PASS.
 */
export function classifyBalanceCase(input: {
  worstRatio: number | null;
  minAsymptoticOrder: number | null;
  asymptoticOrders: readonly (number | null)[];
  residualOverIntegral: number | null;
  /** |residual| at the finest step and final time. */
  finestResidual: number | null;
  /** Estimated double-precision floor for the residual at that step. */
  roundOffFloor: number | null;
  budgetComputable: boolean;
}): { status: BalanceStatus; diagnosis: BalanceDiagnosis; reasons: string[] } {
  const { worstRatio, asymptoticOrders, residualOverIntegral } = input;
  if (!input.budgetComputable || worstRatio === null) {
    return {
      status: "UNRESOLVED",
      diagnosis: "BUDGET_NOT_COMPUTABLE",
      reasons: ["No error budget is computable for this case, so the criterion cannot be applied."],
    };
  }
  if (!Number.isFinite(worstRatio) || worstRatio <= 0) {
    return {
      status: "UNRESOLVED",
      diagnosis: "INVALID_RATIO",
      reasons: [`Measured ratio ${worstRatio} is not a usable positive finite number.`],
    };
  }
  if (residualOverIntegral !== null && residualOverIntegral > BALANCE_CLASSIFICATION.maxResidualOverBalance) {
    return {
      status: "UNRESOLVED",
      diagnosis: "BALANCE_BELOW_RESOLUTION",
      reasons: [
        `Residual is ${residualOverIntegral.toExponential(2)}x the integral it should be negligible against, so this case has no usable signal.`,
      ],
    };
  }
  if (worstRatio > BALANCE_CLASSIFICATION.failRatio) {
    return {
      status: "FAIL",
      diagnosis: "BUDGET_EXCEEDED_BEYOND_10X",
      reasons: [
        `Residual exceeds its budget by ${worstRatio.toExponential(2)}x, beyond the ${BALANCE_CLASSIFICATION.failRatio}x level at which the criterion is treated as violated. This is a failure of the numerical acceptance criterion; the cause (estimate limitation versus implementation defect) is not identified by this number.`,
      ],
    };
  }
  if (worstRatio > BALANCE_CLASSIFICATION.cautionRatio) {
    return {
      status: "UNRESOLVED",
      diagnosis: "BUDGET_EXCEEDED_WITHIN_10X",
      reasons: [
        `Residual exceeds its budget by ${worstRatio.toExponential(2)}x: the budget is not conservative for this case, and the evidence cannot resolve whether that is an estimate limitation or a defect.`,
      ],
    };
  }
  const computable = asymptoticOrders.filter((o): o is number => o !== null);
  if (input.minAsymptoticOrder === null || computable.length === 0) {
    return {
      status: "UNRESOLVED",
      diagnosis: "ORDER_NOT_COMPUTABLE",
      reasons: ["Residual order is not computable for this case, so the order criterion cannot be applied."],
    };
  }
  const spread = computable.length >= 2 ? Math.max(...computable) - Math.min(...computable) : null;
  if (spread === null || spread > BALANCE_CLASSIFICATION.maxOrderSpread) {
    // Distinguish "the residual has reached double precision, so no order exists to
    // measure" from "the successive orders disagree". Both are unresolved, but only the
    // second is a statement about the sequence.
    if (
      input.finestResidual !== null &&
      input.roundOffFloor !== null &&
      Math.abs(input.finestResidual) <= input.roundOffFloor
    ) {
      return {
        status: "UNRESOLVED",
        diagnosis: "ORDER_ROUND_OFF_LIMITED",
        reasons: [
          `Finest residual ${Math.abs(input.finestResidual).toExponential(2)} is at or below the estimated round-off floor ${input.roundOffFloor.toExponential(2)} for this run, so the residual decreases at no measurable order. The identity is satisfied at that scale, but the order criterion cannot be applied; this is not evidence of a defect.`,
        ],
      };
    }
    return {
      status: "UNRESOLVED",
      diagnosis: "ORDER_ESTIMATE_UNRELIABLE",
      reasons: [
        spread === null
          ? "Only one asymptotic order estimate is available, so no consistent order is established."
          : `Successive asymptotic order estimates span ${spread.toFixed(3)} order units (${computable.map((o) => o.toFixed(3)).join(", ")}), more than the ${BALANCE_CLASSIFICATION.maxOrderSpread} unit allowed. The sequence has not settled onto a single leading term, so its order is not evidence for or against the criterion.`,
      ],
    };
  }
  if (input.minAsymptoticOrder < BALANCE_CLASSIFICATION.minAsymptoticOrder) {
    return {
      status: "UNRESOLVED",
      diagnosis: "ORDER_BELOW_FLOOR",
      reasons: [
        `Observed residual order ${input.minAsymptoticOrder.toFixed(3)} is below the ${BALANCE_CLASSIFICATION.minAsymptoticOrder} floor expected of a fourth-order method. This is consistent with a formulation defect, with leaving the asymptotic regime, with cancellation or with round-off; it does not demonstrate a defect, so the case is unresolved rather than failed.`,
      ],
    };
  }
  return {
    status: "PASS",
    diagnosis: "CRITERION_MET",
    reasons: [
      `Every budgeted residual is within 1x of its budget (worst ${worstRatio.toExponential(2)}x) and the asymptotic order is ${input.minAsymptoticOrder.toFixed(3)} with a spread of ${spread.toFixed(3)} over the tested refinements.`,
    ],
  };
}

/**
 * Run the balance check over the matrix. For every case the equation is integrated at each
 * step, the residual is evaluated at the reporting fractions, and the budget for a step is
 * built from the self-convergence difference against the NEXT FINER step. The finest step
 * therefore has no budget of its own: a budget needs a finer solution. That limitation is
 * reported rather than papered over, and it is why four steps are used to budget three.
 */
export interface CalibrationOptions {
  steps?: readonly number[];
  /**
   * Trajectory generator. Defaults to `integratePrescribed`. Exposed so a test can inject
   * a deliberately wrong equation, or a generator that ignores its step, and show that the
   * calibration reports FAIL or UNRESOLVED instead of passing. Not used by the app.
   */
  integrate?: typeof integratePrescribed;
}

export function calibrateBalance(
  nRadS: number,
  cases: readonly BalanceCaseSpec[] = BALANCE_CASES,
  options: CalibrationOptions = {},
): CalibrationResult {
  const steps = options.steps ?? [60, 30, 15, 7.5];
  const integrate = options.integrate ?? integratePrescribed;
  const results: BalanceCaseResult[] = cases.map((spec) => {
    const theta0 = (spec.theta0Deg * Math.PI) / 180;
    const thetaDot0 = ((spec.thetaDot0DegPerS ?? 0) * Math.PI) / 180;
    const balanceOpts = {
      nRadS,
      length0M: spec.length0M,
      rateMS: spec.rateMS,
      length: spec.length,
    };
    const runs = steps.map((stepS) =>
      integrate({
        ...balanceOpts,
        theta0Rad: theta0,
        thetaDot0RadPerS: thetaDot0,
        durationS: spec.durationS,
        stepS,
      }),
    );

    const points: BalanceCasePoint[] = [];
    const finalResiduals: number[] = [];
    const runBalances = runs.map((run) => balanceAlong(run.samples, { ...balanceOpts, fractions: BALANCE_FRACTIONS }));
    let worstRatio: number | null = null;
    let worstRatioWhere: { stepS: number; timeS: number } | null = null;

    runs.forEach((run, i) => {
      const balances = runBalances[i];
      const finer = i + 1 < runs.length ? runs[i + 1] : null;
      let budget: number | null = null;
      if (finer) {
        const eps = trajectoryDifference(run.samples, finer.samples);
        if (Number.isFinite(eps.maxTheta) && (eps.maxTheta > 0 || eps.maxThetaDot > 0)) {
          budget = errorBudget(run.samples, {
            ...balanceOpts,
            epsThetaRad: eps.maxTheta,
            epsThetaDotRadPerS: eps.maxThetaDot,
            quadratureTerm: Math.max(...balances.map((b) => b.quadratureError)),
          }).total;
        }
      }
      balances.forEach((b) => {
        const ratio = budget === null || budget <= 0 ? null : Math.abs(b.residual) / budget;
        points.push({ stepS: run.stepS, timeS: b.timeS, residual: b.residual, budget, ratio });
        if (ratio !== null && (worstRatio === null || ratio > worstRatio)) {
          worstRatio = ratio;
          worstRatioWhere = { stepS: run.stepS, timeS: b.timeS };
        }
      });
      finalResiduals.push(Math.abs(balances[balances.length - 1].residual));
    });

    const residualOrders = finalResiduals.map((r, i) =>
      i === 0 || r === 0 || finalResiduals[i - 1] === 0 ? null : Math.log2(finalResiduals[i - 1] / r),
    );
    // residualOrders[i] is the order between steps i-1 and i. Index 1 is the coarsest
    // pair (60 -> 30 s), which is pre-asymptotic; the criterion uses pairs from 30 -> 15 s
    // onward, and the coarsest pair is still reported in residualOrders.
    const asymptoticOrders = residualOrders.slice(2);
    const asymptoticValues = asymptoticOrders.filter((o): o is number => o !== null);
    const minAsymptoticOrder = asymptoticValues.length > 0 ? Math.min(...asymptoticValues) : null;
    const maxAsymptoticOrder = asymptoticValues.length > 0 ? Math.max(...asymptoticValues) : null;
    const orderSpread =
      asymptoticValues.length >= 2 ? Math.max(...asymptoticValues) - Math.min(...asymptoticValues) : null;
    const ordersReliable = orderSpread !== null && orderSpread <= BALANCE_CLASSIFICATION.maxOrderSpread;

    const lastRun = runs[runs.length - 1];
    const lastBalances = runBalances[runBalances.length - 1];
    const lastPoint = lastBalances[lastBalances.length - 1];
    // Round-off floor: a first-order estimate of the smallest residual this run could
    // resolve, from the magnitude of the terms being differenced.
    const maxAbsK = lastRun.samples.reduce(
      (m, sample) => Math.max(m, Math.abs(librationK(sample.theta, sample.thetaDot, nRadS))),
      0,
    );
    const roundOffFloor =
      Number.EPSILON * (maxAbsK + Math.abs(lastPoint.integral)) * Math.sqrt(lastRun.steps);
    const residualOverIntegral =
      lastPoint.integral === 0 ? null : Math.abs(lastPoint.residual) / Math.abs(lastPoint.integral);
    const quadValues = lastRun.samples.map((s) =>
      balanceIntegrand(s.thetaDot, s.t, spec.length0M, spec.rateMS, spec.length),
    );
    const quadratureOrderFinal = quadratureWithEstimate(quadValues, lastRun.stepS).observedOrder;

    const first = lastRun.samples[0];
    const last = lastRun.samples[lastRun.samples.length - 1];
    const inv0 = scaledInvariant(first, nRadS, spec.length0M, spec.rateMS, spec.length);
    const inv1 = scaledInvariant(last, nRadS, spec.length0M, spec.rateMS, spec.length);
    const l4Drift = inv0 === 0 ? Number.NaN : Math.abs(inv1 - inv0) / Math.abs(inv0);

    const verdict = classifyBalanceCase({
      worstRatio,
      minAsymptoticOrder,
      asymptoticOrders,
      residualOverIntegral,
      finestResidual: lastPoint.residual,
      roundOffFloor,
      budgetComputable: worstRatio !== null,
    });

    const unbudgetedResiduals = lastBalances.map((b) => ({
      stepS: lastRun.stepS,
      timeS: b.timeS,
      residual: b.residual,
    }));
    const budgetedPoints = points.filter((p) => p.budget !== null).length;

    return {
      caseId: spec.caseId,
      description: spec.description,
      regime: spec.regime,
      steps: runs.map((r) => r.stepS),
      points,
      worstRatio,
      worstRatioWhere,
      finalResiduals,
      residualOrders,
      asymptoticOrders,
      orderSpread,
      ordersReliable,
      residualOverIntegral,
      minAsymptoticOrder,
      maxAsymptoticOrder,
      quadratureOrderFinal,
      roundOffFloor,
      l4Drift,
      unbudgetedResiduals,
      budgetedPoints,
      unbudgetedPoints: unbudgetedResiduals.length,
      status: verdict.status,
      diagnosis: verdict.diagnosis,
      reasons: verdict.reasons,
    };
  });

  const worst = results.reduce<{ ratio: number; caseId: string } | null>((acc, r) => {
    if (r.worstRatio === null) return acc;
    return acc === null || r.worstRatio > acc.ratio ? { ratio: r.worstRatio, caseId: r.caseId } : acc;
  }, null);

  const casesFailing = results.filter((r) => r.status === "FAIL").length;
  const casesUnresolved = results.filter((r) => r.status === "UNRESOLVED").length;
  const casesPassing = results.filter((r) => r.status === "PASS").length;
  const status: BalanceStatus =
    casesFailing > 0 ? "FAIL" : casesUnresolved > 0 ? "UNRESOLVED" : "PASS";

  return {
    cases: results,
    worstRatio: worst?.ratio ?? null,
    worstCaseId: worst?.caseId ?? null,
    status,
    casesPassing,
    casesUnresolved,
    casesFailing,
    reportingTimes: BALANCE_FRACTIONS.length,
    totalBudgetedPoints: results.reduce((n, r) => n + r.budgetedPoints, 0),
    totalUnbudgetedPoints: results.reduce((n, r) => n + r.unbudgetedPoints, 0),
    configurations: results.length,
  };
}
