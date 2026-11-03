/**
 * SVG charts rendered from computed series only. No decorative or synthetic data:
 * every point comes from a stored calculation result.
 */

import { useId } from "react";

export interface ChartSeries {
  values: number[];
  label: string;
  variant?: "primary" | "secondary" | "third";
}

const W = 660;
const PAD = { l: 62, r: 14, t: 14, b: 30 };

function tickLabel(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-2) return v.toExponential(1).replace("e+", "e");
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

interface LineChartProps {
  x: number[];
  series: ChartSeries[];
  xLabel: string;
  yLabel: string;
  logY?: boolean;
  height?: number;
  caption?: string;
}

export function LineChart({ x, series, xLabel, yLabel, logY = false, height = 240, caption }: LineChartProps) {
  const clipId = useId();
  const usable = series.filter((s) => s.values.length === x.length && x.length > 1);
  const innerW = W - PAD.l - PAD.r;
  const innerH = height - PAD.t - PAD.b;

  if (usable.length === 0) {
    return (
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${yLabel} versus ${xLabel}: no data`}>
        <text className="chart-empty" x={W / 2} y={height / 2} textAnchor="middle">
          No computed samples available
        </text>
      </svg>
    );
  }

  const xs = x.filter((v) => Number.isFinite(v));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const xSpan = xMax - xMin || 1;

  // For a log axis, non-positive values cannot be plotted; they are clamped to a
  // documented floor and the caption says so.
  const FLOOR = 1e-30;
  const transform = (v: number): number => (logY ? Math.log10(Math.max(v, FLOOR)) : v);
  const allY = usable.flatMap((s) => s.values.filter((v) => Number.isFinite(v)).map(transform));
  let yMin = Math.min(...allY);
  let yMax = Math.max(...allY);
  if (yMax - yMin < 1e-30) {
    const pad = Math.abs(yMax) * 0.1 || 1;
    yMin -= pad;
    yMax += pad;
  } else {
    const pad = (yMax - yMin) * 0.08;
    yMin -= pad;
    yMax += pad;
  }
  const ySpan = yMax - yMin || 1;

  const sx = (v: number) => PAD.l + ((v - xMin) / xSpan) * innerW;
  const sy = (v: number) => PAD.t + innerH - ((transform(v) - yMin) / ySpan) * innerH;

  const xTicks = Array.from({ length: 5 }, (_, i) => xMin + (i / 4) * xSpan);
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i / 4) * ySpan);

  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label={`${yLabel} versus ${xLabel}`}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.l} y={PAD.t} width={innerW} height={innerH} />
          </clipPath>
        </defs>
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line className="chart-grid" x1={PAD.l} x2={PAD.l + innerW} y1={sy(logY ? Math.pow(10, t) : t)} y2={sy(logY ? Math.pow(10, t) : t)} />
            <text className="chart-tick" x={PAD.l - 8} y={sy(logY ? Math.pow(10, t) : t) + 3} textAnchor="end">
              {logY ? tickLabel(Math.pow(10, t)) : tickLabel(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={`x${i}`} className="chart-tick" x={sx(t)} y={height - 10} textAnchor="middle">
            {tickLabel(t)}
          </text>
        ))}
        <line className="chart-axis" x1={PAD.l} x2={PAD.l + innerW} y1={PAD.t + innerH} y2={PAD.t + innerH} />
        <line className="chart-axis" x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + innerH} />
        <g clipPath={`url(#${clipId})`}>
          {usable.map((s, idx) => {
            const d = s.values
              .map((v, i) => {
                const xx = sx(x[i]);
                const yy = sy(v);
                return `${i === 0 ? "M" : "L"}${xx.toFixed(2)},${yy.toFixed(2)}`;
              })
              .join(" ");
            return (
              <path
                key={s.label}
                className={`chart-line${s.variant && s.variant !== "primary" ? ` ${s.variant}` : ""}`}
                d={d}
                style={idx === 0 ? undefined : { stroke: undefined }}
              />
            );
          })}
        </g>
        <text className="chart-label" x={PAD.l + innerW / 2} y={height - 14} textAnchor="middle">
          {xLabel}
        </text>
        <text className="chart-label" x={12} y={PAD.t + innerH / 2} textAnchor="middle" transform={`rotate(-90 12 ${PAD.t + innerH / 2})`}>
          {yLabel}
        </text>
      </svg>
      <div className="legend">
        {usable.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.variant === "secondary" ? "var(--unresolved)" : s.variant === "third" ? "var(--blocked)" : "var(--cyan)" }} />
            {s.label}
          </span>
        ))}
        {logY && <span className="faint">log₁₀ scale; non-positive samples clamped to {FLOOR.toExponential(0)}</span>}
        {caption && <span className="faint">{caption}</span>}
      </div>
    </div>
  );
}

interface OrbitPlotProps {
  x: number[];
  y: number[];
  earthRadiusM: number;
  label?: string;
}

/** Inertial X–Y projection of the computed trajectory, in km, with equal aspect. */
export function OrbitPlot({ x, y, earthRadiusM, label }: OrbitPlotProps) {
  const height = 340;
  const innerW = W - PAD.l - PAD.r;
  const innerH = height - PAD.t - PAD.b;
  if (x.length < 2 || x.length !== y.length) {
    return (
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Orbit projection: no data">
        <text className="chart-empty" x={W / 2} y={height / 2} textAnchor="middle">
          No computed samples available
        </text>
      </svg>
    );
  }
  const km = (v: number) => v / 1000;
  const xs = x.map(km);
  const ys = y.map(km);
  const extent = Math.max(
    ...xs.map(Math.abs),
    ...ys.map(Math.abs),
    km(earthRadiusM) * 1.05,
  );
  const scale = Math.min(innerW, innerH) / (2 * extent);
  const cx = PAD.l + innerW / 2;
  const cy = PAD.t + innerH / 2;
  const px = (v: number) => cx + v * scale;
  const py = (v: number) => cy - v * scale;
  const d = xs.map((v, i) => `${i === 0 ? "M" : "L"}${px(v).toFixed(2)},${py(ys[i]).toFixed(2)}`).join(" ");
  const earthR = km(earthRadiusM) * scale;

  return (
    <div>
      <svg className="chart" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Inertial X-Y projection of the computed trajectory">
        <line className="chart-grid" x1={PAD.l} x2={PAD.l + innerW} y1={cy} y2={cy} />
        <line className="chart-grid" x1={cx} x2={cx} y1={PAD.t} y2={PAD.t + innerH} />
        <circle cx={cx} cy={cy} r={earthR} fill="rgba(46,230,246,0.06)" stroke="var(--line)" strokeWidth={1} />
        <text className="chart-tick" x={cx} y={cy + 3} textAnchor="middle">
          Earth
        </text>
        <path className="chart-line" d={d} />
        <circle className="chart-dot" cx={px(xs[0])} cy={py(ys[0])} r={3} />
        <circle cx={px(xs[xs.length - 1])} cy={py(ys[ys.length - 1])} r={3} fill="var(--unresolved)" />
        <line className="chart-axis" x1={PAD.l} x2={PAD.l + innerW} y1={PAD.t + innerH} y2={PAD.t + innerH} />
        <text className="chart-label" x={cx} y={height - 4} textAnchor="middle">
          x (km, inertial)
        </text>
        <text className="chart-label" x={12} y={cy} textAnchor="middle" transform={`rotate(-90 12 ${cy})`}>
          y (km, inertial)
        </text>
      </svg>
      <div className="legend">
        <span><i style={{ background: "var(--cyan)" }} />computed trajectory</span>
        <span><i style={{ background: "var(--cyan)", opacity: 0.35 }} />start marker</span>
        <span><i style={{ background: "var(--unresolved)" }} />end marker</span>
        {label && <span className="faint">{label}</span>}
      </div>
    </div>
  );
}
