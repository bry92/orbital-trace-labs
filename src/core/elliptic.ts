/**
 * Jacobi elliptic functions, used only to build an independent ANALYTIC reference
 * solution for the constant-length tether libration equation.
 *
 * This module is NOT part of any propagation path: the engine integrates the ODE;
 * the reference is evaluated from the closed-form solution. Keeping the two paths
 * separate is what makes the convergence study meaningful.
 *
 * Derivation of the solution used
 * -------------------------------
 * The implemented libration equation at constant length L and constant mean motion
 * n is
 *     theta'' = -3 n^2 sin(theta) cos(theta)
 * Substituting u = 2 theta gives sin(theta)cos(theta) = (1/2) sin u, so
 *     u'' = -3 n^2 sin u  =  -omega^2 sin u,   omega = sqrt(3) n
 * which is the ideal pendulum equation. With u(0) = u0, u'(0) = 0 and
 * k = sin(u0 / 2) in [0, 1), the exact solution is
 *     sin(u(t) / 2) = k sn(omega t + K(k), k)
 * where sn is the Jacobi sine amplitude with modulus k and K(k) is the complete
 * elliptic integral of the first kind. K is chosen so that sn(K, k) = 1 at t = 0.
 * Differentiating,
 *     u'(t) = 2 omega k cn(K + omega t, k) dn(K + omega t, k) / cos(u/2)
 * and theta = u/2, theta' = u'/2.
 *
 * The exact period is T = 4 K(k) / omega, which reduces to 2 pi / omega as k -> 0
 * (the small-angle result). This is an exact solution of the non-linear equation,
 * not a small-angle approximation, so it is a legitimate reference at finite
 * amplitude. It is exact only for CONSTANT n and CONSTANT L.
 *
 * Computation
 * -----------
 * sn, cn and dn are computed through the descending Landen (arithmetic-geometric
 * mean) transformation of the amplitude, which converges quadratically. The
 * implementation is verified in the test suite by (a) algebraic identities,
 * (b) the exact period 4K/omega, and (c) agreement with an independent adaptive
 * integration of the same ODE at tight tolerance.
 */

const EPS = Number.EPSILON;

/** Arithmetic-geometric mean of two positive numbers. */
export function agm(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) throw new Error(`AGM requires positive arguments; received ${a}, ${b}.`);
  let x = a;
  let y = b;
  for (let i = 0; i < 100; i++) {
    const nx = 0.5 * (x + y);
    const ny = Math.sqrt(x * y);
    if (Math.abs(nx - ny) <= EPS * nx) return nx;
    x = nx;
    y = ny;
  }
  return x;
}

/**
 * Complete elliptic integral of the first kind K(k), modulus k in [0, 1).
 * K(k) = pi / (2 AGM(1, sqrt(1 - k^2))).
 */
export function completeEllipticK(k: number): number {
  if (!(k >= 0) || !(k < 1)) {
    throw new Error(`Complete elliptic integral K(k) requires 0 <= k < 1; received k = ${k}.`);
  }
  const kp = Math.sqrt(1 - k * k);
  return Math.PI / (2 * agm(1, kp));
}

export interface JacobiValue {
  /** Amplitude phi = am(u, k), radians. */
  phi: number;
  sn: number;
  cn: number;
  dn: number;
}

/**
 * Jacobi amplitude and sn/cn/dn at argument u with modulus k in [0, 1).
 *
 * Descending Landen recursion: with a0 = 1, b0 = k' = sqrt(1-k^2), c0 = k, form
 *     a(n+1) = (a(n)+b(n))/2,  b(n+1) = sqrt(a(n) b(n)),  c(n+1) = (a(n)-b(n))/2
 * until c(N) is negligible, then
 *     phi_N = 2^N a_N u
 *     phi_n = (phi_(n+1) + asin( (c_(n+1)/a_(n+1)) sin phi_(n+1) )) / 2
 * and sn = sin phi_0, cn = cos phi_0, dn = sqrt(1 - k^2 sn^2).
 */
export function jacobiAmplitude(u: number, k: number): JacobiValue {
  if (!Number.isFinite(u)) throw new Error(`Jacobi amplitude requires a finite argument; received ${u}.`);
  if (!(k >= 0) || !(k < 1)) {
    throw new Error(`Jacobi elliptic functions require 0 <= k < 1; received k = ${k}.`);
  }
  if (k === 0) {
    return { phi: u, sn: Math.sin(u), cn: Math.cos(u), dn: 1 };
  }

  // Landen sequences. c holds the correction ratios used on the way back.
  const a: number[] = [1];
  const c: number[] = [k];
  let b = Math.sqrt(1 - k * k);
  let an = 1;
  let levels = 0;
  for (let i = 0; i < 100; i++) {
    const an1 = 0.5 * (an + b);
    const bn1 = Math.sqrt(an * b);
    const cn1 = 0.5 * (an - b);
    a.push(an1);
    c.push(cn1);
    levels = i + 1;
    an = an1;
    b = bn1;
    if (Math.abs(cn1) <= EPS * an1) break;
  }

  // phi_N = 2^N a_N u. Note 2^N a_N -> 2K/pi, so at u = K this is 2^N pi/2 and the
  // recursion below folds it down to pi/2, i.e. sn = 1.
  let phi = Math.pow(2, levels) * a[levels] * u;
  for (let i = levels - 1; i >= 0; i--) {
    phi = 0.5 * (phi + Math.asin(Math.min(1, Math.max(-1, (c[i + 1] / a[i + 1]) * Math.sin(phi)))));
  }
  const sn = Math.sin(phi);
  return { phi, sn, cn: Math.cos(phi), dn: Math.sqrt(Math.max(0, 1 - k * k * sn * sn)) };
}

/**
 * Exact solution of the pendulum equation u'' = -omega^2 sin u for
 * u(0) = u0 in (0, pi), u'(0) = 0, valid for all t >= 0.
 *
 * Returns the angle and angular rate in the SAME units as u0 (radians, radians per
 * second if omega is in radians per second).
 */
export function pendulumExact(u0Rad: number, omegaRadS: number, tS: number): { u: number; uDot: number } {
  if (!(u0Rad > 0) || !(u0Rad < Math.PI)) {
    throw new Error(`Exact pendulum reference requires 0 < u0 < pi; received ${u0Rad}.`);
  }
  if (!(omegaRadS > 0) || !Number.isFinite(omegaRadS)) {
    throw new Error(`Exact pendulum reference requires a positive finite omega; received ${omegaRadS}.`);
  }
  const k = Math.sin(u0Rad / 2);
  const K = completeEllipticK(k);
  const phase = K + omegaRadS * tS;
  const { sn, cn, dn } = jacobiAmplitude(phase, k);
  const s = Math.min(1, Math.max(-1, k * sn));
  const u = 2 * Math.asin(s);
  const cosHalf = Math.cos(u / 2);
  const uDot = cosHalf === 0 ? 0 : (2 * omegaRadS * k * cn * dn) / cosHalf;
  return { u, uDot };
}
