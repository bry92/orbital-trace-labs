/**
 * Tests for the analytic Jacobi-elliptic reference used by the tether convergence
 * study. These tests validate the REFERENCE, independently of the tether engine.
 */

import { describe, expect, it } from "vitest";
import {
  completeEllipticK,
  jacobiAmplitude,
  pendulumExact,
} from "../core/elliptic";
import { integrateDOPRI5, type DerivFunc } from "../core/integrators";

const K_05 = completeEllipticK(0.5);

describe("Jacobi elliptic functions", () => {
  it("satisfies the defining algebraic identities", () => {
    for (const k of [0.01, 0.2, 0.5, 0.9]) {
      for (const u of [0, 0.1, 0.7, 1.3, 2.9, 4.4, -1.1]) {
        const { sn, cn, dn } = jacobiAmplitude(u, k);
        expect(Math.abs(sn * sn + cn * cn - 1)).toBeLessThan(1e-14);
        expect(Math.abs(dn * dn - (1 - k * k * sn * sn))).toBeLessThan(1e-13);
      }
    }
  });

  it("has sn(K) = 1 and dn(K) = sqrt(1-k^2)", () => {
    for (const k of [0.1, 0.5, 0.8]) {
      const K = completeEllipticK(k);
      const { sn, cn, dn } = jacobiAmplitude(K, k);
      expect(Math.abs(sn - 1)).toBeLessThan(1e-14);
      expect(Math.abs(cn)).toBeLessThan(1e-14);
      expect(Math.abs(dn - Math.sqrt(1 - k * k))).toBeLessThan(1e-13);
    }
  });

  it("K(k) reproduces known values", () => {
    // DLMF 19.5: K(0) = pi/2, K(1/sqrt(2)) = 1.8540746773013719.
    expect(Math.abs(completeEllipticK(0) - Math.PI / 2)).toBeLessThan(1e-15);
    expect(Math.abs(completeEllipticK(Math.SQRT1_2) - 1.8540746773013719)).toBeLessThan(1e-14);
    expect(K_05).toBeGreaterThan(1.6);
    expect(K_05).toBeLessThan(1.7);
  });
});

describe("exact pendulum solution", () => {
  const omega = 1.9586e-3; // rad/s, sqrt(3) * n at 400 km altitude

  it("is periodic with T = 4K/omega", () => {
    for (const theta0 of [0.001, 0.05, 0.2, 0.6]) {
      const k = Math.sin(theta0);
      const T = (4 * completeEllipticK(k)) / omega;
      const a = pendulumExact(2 * theta0, omega, 0);
      const b = pendulumExact(2 * theta0, omega, T);
      expect(Math.abs(a.u - b.u)).toBeLessThan(1e-12);
      // A quarter period after the turning point the angle passes zero with the
      // maximum rate, u' = -2 k omega (the angle is decreasing through zero).
      const q = pendulumExact(2 * theta0, omega, T / 4);
      expect(Math.abs(q.u)).toBeLessThan(1e-11);
      expect(Math.abs(q.uDot + 2 * k * omega)).toBeLessThan(1e-13);
    }
  });

  it("has zero initial rate and the prescribed initial angle", () => {
    const r = pendulumExact(0.3, omega, 0);
    expect(Math.abs(r.u - 0.3)).toBeLessThan(1e-13);
    expect(Math.abs(r.uDot)).toBeLessThan(1e-15);
  });

  it("agrees with an independent adaptive integration of the same ODE", () => {
    const theta0 = 0.08; // rad
    const u0 = 2 * theta0;
    const T = (4 * completeEllipticK(Math.sin(theta0))) / omega;
    const duration = T * 1.75;
    const f: DerivFunc = (_t, y, out) => {
      out[0] = y[1];
      out[1] = -omega * omega * Math.sin(y[0]);
    };
    const y0 = new Float64Array([u0, 0]);
    let uEnd = 0;
    let uDotEnd = 0;
    integrateDOPRI5(f, y0, duration, {
      relTol: 1e-13,
      absTol: 1e-15,
      initialStepS: 1,
      maxStepS: 20,
      minStepS: 1e-9,
      maxSteps: 2_000_000,
      onSample: (_t, y) => {
        uEnd = y[0];
        uDotEnd = y[1];
      },
    });
    const exact = pendulumExact(u0, omega, duration);
    expect(Math.abs(uEnd - exact.u)).toBeLessThan(1e-11);
    expect(Math.abs(uDotEnd - exact.uDot)).toBeLessThan(1e-14);
  });

  it("reduces to the small-angle cosine in the limit theta0 -> 0", () => {
    const tiny = 1e-7;
    const t = 1234.5;
    const r = pendulumExact(2 * tiny, omega, t);
    const linear = tiny * Math.cos(omega * t);
    expect(Math.abs(r.u / 2 - linear)).toBeLessThan(1e-18);
  });

  it("rejects amplitude and modulus outside the supported range", () => {
    expect(() => pendulumExact(0, omega, 1)).toThrow(/0 < u0 < pi/);
    expect(() => pendulumExact(Math.PI, omega, 1)).toThrow(/0 < u0 < pi/);
    expect(() => pendulumExact(1, 0, 1)).toThrow(/positive finite omega/);
    expect(() => jacobiAmplitude(1, 1)).toThrow(/0 <= k < 1/);
    expect(() => jacobiAmplitude(Number.NaN, 0.3)).toThrow(/finite argument/);
  });
});
