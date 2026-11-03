/**
 * Presentation mapping for stored runs.
 *
 * The summary header and the trajectory charts used to read fixed two-body metric
 * and series keys. For a tether run that produced empty cells and empty charts which
 * looked like missing data rather than "this model reports different quantities".
 *
 * Everything here is derived from the record, so it is unit-testable without a DOM.
 * Nothing in this module computes physics; it only selects fields a model already
 * reports and labels them with the model's own units.
 */

import type { RunRecord } from "../core/run";

/** Significant digits used for run-summary values, matching the detail tables. */
export const SUMMARY_DIGITS = 10;

export interface HeadlineItem {
  id: string;
  label: string;
  value: number | null;
  unit: string;
  note?: string;
  /** True when the model has no such metric at all (never silently rendered as "—"). */
  notReportedByModel: boolean;
}

export interface ChartPlan {
  id: string;
  title: string;
  xLabel: string;
  yLabel: string;
  logY: boolean;
  caption?: string;
  available: boolean;
  unavailableReason: string | null;
  x: number[];
  series: { values: number[]; label: string; variant?: "primary" | "secondary" }[];
}

export interface SampleCounts {
  stored: number;
  computed: number;
}

const SUMMARY_EXCLUDED = new Set(["steps", "samples", "stepsRejected"]);

/** Headline quantities per model, in display order. */
const HEADLINE_IDS: Record<string, string[]> = {
  "OTL-2BP": ["finalRadius", "finalSpeed", "epsEnergy", "epsAngularMomentum", "period"],
  "OTL-TETH-1": ["thetaFinal", "tetherLengthFinal", "tensionMax", "maxAbsTheta", "orbitPeriod"],
};

interface SeriesSlot {
  key: string;
  label: string;
  variant?: "primary" | "secondary";
  scale?: number;
}

interface ChartSlot {
  id: string;
  title: string;
  xLabel: string;
  yLabel: string;
  logY?: boolean;
  caption?: string;
  series: SeriesSlot[];
}

const RADIUS: ChartSlot = {
  id: "radius",
  title: "Centre-of-mass radius",
  xLabel: "time (min)",
  yLabel: "radius (km)",
  series: [{ key: "radius", label: "|r| radius", scale: 1e-3 }],
};

const SPEED: ChartSlot = {
  id: "speed",
  title: "Centre-of-mass speed",
  xLabel: "time (min)",
  yLabel: "speed (km/s)",
  series: [{ key: "speed", label: "|v| speed", scale: 1e-3 }],
};

const CHART_SLOTS: Record<string, ChartSlot[]> = {
  "OTL-2BP": [
    RADIUS,
    SPEED,
    {
      id: "invariants",
      title: "Numerical invariants",
      xLabel: "time (min)",
      yLabel: "normalised discrepancy",
      logY: true,
      caption: "Numerical invariants of the propagated trajectory (not physical measurement error).",
      series: [
        { key: "epsEnergy", label: "ε_E energy" },
        { key: "epsAngularMomentum", label: "ε_h angular momentum", variant: "secondary" },
      ],
    },
    {
      id: "energy",
      title: "Specific energy",
      xLabel: "time (min)",
      yLabel: "specific energy (MJ/kg)",
      series: [{ key: "energy", label: "E specific energy", scale: 1e-6 }],
    },
  ],
  "OTL-TETH-1": [
    RADIUS,
    SPEED,
    {
      id: "invariants",
      title: "Reference-orbit numerical invariants",
      xLabel: "time (min)",
      yLabel: "normalised discrepancy",
      logY: true,
      caption:
        "Reference-orbit invariants only. The tether subsystem is not closed under a prescribed length history, so no total-system conservation is claimed or tested.",
      series: [
        { key: "epsEnergyOrbit", label: "ε_E (reference orbit only)" },
        { key: "epsAngularMomentumOrbit", label: "ε_h (reference orbit only)", variant: "secondary" },
      ],
    },
    {
      id: "energy",
      title: "Reference-orbit specific energy",
      xLabel: "time (min)",
      yLabel: "reference-orbit energy (MJ/kg)",
      series: [{ key: "orbitEnergy", label: "reference-orbit energy", scale: 1e-6 }],
    },
  ],
};

/**
 * New models inherit the two-body layout only if they genuinely use the same column
 * keys; otherwise they get radius/speed when present and nothing invented.
 */
const FALLBACK_SLOTS: ChartSlot[] = [RADIUS, SPEED];

export function headlineMetrics(run: RunRecord): HeadlineItem[] {
  const ids =
    HEADLINE_IDS[run.model.id] ??
    run.metrics
      .filter((m) => !SUMMARY_EXCLUDED.has(m.id))
      .slice(0, 5)
      .map((m) => m.id);

  return ids.map((id) => {
    const metric = run.metrics.find((m) => m.id === id);
    if (!metric) {
      return {
        id,
        label: id,
        value: null,
        unit: "",
        note: `${run.model.id} does not report a metric with this id.`,
        notReportedByModel: true,
      };
    }
    return {
      id,
      label: metric.label,
      value: metric.value,
      unit: metric.unit,
      note: metric.note,
      notReportedByModel: false,
    };
  });
}

/** Stored versus computed sample counts, taken from the recorded decimation block. */
export function sampleCounts(run: RunRecord): SampleCounts {
  return {
    stored: run.series.decimation.recordedSampleCount,
    computed: run.series.decimation.originalSampleCount,
  };
}

export function planCharts(run: RunRecord): ChartPlan[] {
  const slots = CHART_SLOTS[run.model.id] ?? FALLBACK_SLOTS;
  const availableKeys = Object.keys(run.series.data);

  return slots.map((slot) => {
    const t = run.series.data.t ?? [];
    const x = t.map((v) => v / 60);
    const missing: string[] = [];
    const series: ChartPlan["series"] = [];

    for (const s of slot.series) {
      const raw = run.series.data[s.key];
      if (!raw || raw.length === 0 || raw.length !== x.length) {
        missing.push(s.key);
        continue;
      }
      const scale = s.scale ?? 1;
      series.push({
        values: raw.map((v) => v * scale),
        label: s.label,
        variant: s.variant,
      });
    }

    const usable = x.length > 1 && series.length === slot.series.length;
    return {
      id: slot.id,
      title: slot.title,
      xLabel: slot.xLabel,
      yLabel: slot.yLabel,
      logY: slot.logY ?? false,
      caption: slot.caption,
      available: usable,
      unavailableReason: usable
        ? null
        : `Not plotted: ${run.model.id} does not emit ${
            missing.length === 1 ? "the series column" : "the series columns"
          } ${missing.map((m) => `"${m}"`).join(", ")}. Columns present: ${availableKeys.join(", ")}.`,
      x: usable ? x : [],
      series: usable ? series : [],
    };
  });
}
