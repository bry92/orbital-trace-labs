/**
 * Unit registry. Internally every quantity is SI:
 * distance m, time s, mass kg, velocity m/s, acceleration m/s^2, mu m^3/s^2.
 * User-facing inputs may be entered in the listed display units and are converted
 * exactly once, at validation time, into SI. Export metadata records both the
 * display unit entered and the SI value used.
 */

export type QuantityKind =
  | "length"
  | "time"
  | "mass"
  | "velocity"
  | "angle"
  | "angularRate"
  | "gravitationalParameter"
  | "force"
  | "linearDensity"
  | "dimensionless";

export interface UnitDef {
  id: string;
  symbol: string;
  quantity: QuantityKind;
  /** Multiplier applied to a value expressed in this unit to obtain SI. */
  toSI: number;
}

export const UNITS: Record<string, UnitDef> = {
  m: { id: "m", symbol: "m", quantity: "length", toSI: 1 },
  km: { id: "km", symbol: "km", quantity: "length", toSI: 1000 },
  s: { id: "s", symbol: "s", quantity: "time", toSI: 1 },
  h: { id: "h", symbol: "h", quantity: "time", toSI: 3600 },
  d: { id: "d", symbol: "d", quantity: "time", toSI: 86400 },
  kg: { id: "kg", symbol: "kg", quantity: "mass", toSI: 1 },
  mps: { id: "mps", symbol: "m/s", quantity: "velocity", toSI: 1 },
  kmps: { id: "kmps", symbol: "km/s", quantity: "velocity", toSI: 1000 },
  deg: { id: "deg", symbol: "deg", quantity: "angle", toSI: Math.PI / 180 },
  rad: { id: "rad", symbol: "rad", quantity: "angle", toSI: 1 },
  degps: { id: "degps", symbol: "deg/s", quantity: "angularRate", toSI: Math.PI / 180 },
  radps: { id: "radps", symbol: "rad/s", quantity: "angularRate", toSI: 1 },
  m3s2: { id: "m3s2", symbol: "m^3/s^2", quantity: "gravitationalParameter", toSI: 1 },
  N: { id: "N", symbol: "N", quantity: "force", toSI: 1 },
  kgpm: { id: "kgpm", symbol: "kg/m", quantity: "linearDensity", toSI: 1 },
  none: { id: "none", symbol: "-", quantity: "dimensionless", toSI: 1 },
};

export const unitSymbol = (id: string): string => UNITS[id]?.symbol ?? id;

export function toSI(value: number, unitId: string): number {
  const u = UNITS[unitId];
  if (!u) throw new Error(`Unknown unit id: ${unitId}`);
  return value * u.toSI;
}

export function fromSI(value: number, unitId: string): number {
  const u = UNITS[unitId];
  if (!u) throw new Error(`Unknown unit id: ${unitId}`);
  return value / u.toSI;
}

/** Format a number for technical display with a fixed significant-digit budget. */
export function fmt(value: number | null | undefined, digits = 6): string {
  if (value === null || value === undefined) return "—";
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e7)) return value.toExponential(digits);
  return value.toLocaleString("en-US", { maximumSignificantDigits: digits });
}
