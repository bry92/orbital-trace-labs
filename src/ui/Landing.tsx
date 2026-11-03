/**
 * Public entry point for Orbital Trace Labs.
 *
 * This is a static presentation layer only. It performs no calculation, holds no
 * state beyond what it is given, and reads nothing outside the existing registries
 * (models, verification checks, evidence) so that every figure it displays is
 * derived from the same source of record the rest of the application reports from.
 *
 * It deliberately repeats the research-prototype disclaimer rather than relegating
 * it to a footer: the landing page is the first thing a visitor sees, and it must
 * not read as a flight-qualified product.
 */

import {
  APP_CLASSIFICATION,
  APP_NAME,
  APP_RELEASE_LABEL,
  APP_VERSION,
  DISCLAIMER,
} from "../core/constants";
import { IMPLEMENTED_MODEL_IDS, MODELS } from "../models/registry";
import { EVIDENCE_REGISTER, evidenceStatusCounts } from "../evidence/register";
import { ALL_CHECKS } from "../verification/registry";
import { Panel, Stat, StatusBadge, Callout } from "./components";

const DISCLAIMER_REST = DISCLAIMER.replace("RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE. ", "");

/** Decorative orbital / tether geometry. Not data, not a plot of any run. */
function HeroArt() {
  return (
    <svg
      className="landing-art"
      viewBox="0 0 460 360"
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="otl-horizon" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(46,230,246,0.30)" />
          <stop offset="100%" stopColor="rgba(46,230,246,0)" />
        </linearGradient>
        <radialGradient id="otl-limb" cx="50%" cy="50%" r="50%">
          <stop offset="70%" stopColor="rgba(46,230,246,0)" />
          <stop offset="100%" stopColor="rgba(46,230,246,0.35)" />
        </radialGradient>
      </defs>

      {/* Earth limb and horizon glow */}
      <circle cx="230" cy="392" r="176" fill="url(#otl-limb)" stroke="rgba(46,230,246,0.35)" />
      <path d="M54 250 A 176 176 0 0 1 406 250" fill="url(#otl-horizon)" opacity="0.5" />

      {/* In-plane reference orbit (ellipse), drawn as geometry, not as a result */}
      <ellipse
        cx="230"
        cy="196"
        rx="150"
        ry="86"
        fill="none"
        stroke="rgba(46,230,246,0.34)"
        strokeDasharray="3 5"
        transform="rotate(-14 230 196)"
      />
      <ellipse
        cx="230"
        cy="196"
        rx="104"
        ry="58"
        fill="none"
        stroke="rgba(139,166,193,0.22)"
        transform="rotate(-14 230 196)"
      />

      {/* Central body marker */}
      <circle cx="230" cy="196" r="3.4" fill="rgba(46,230,246,0.85)" />
      <circle cx="230" cy="196" r="9" fill="none" stroke="rgba(46,230,246,0.30)" />

      {/* Tether: two end masses joined by a line along the local vertical */}
      <line x1="316" y1="150" x2="352" y2="238" stroke="rgba(46,230,246,0.75)" strokeWidth="1.4" />
      <rect x="311" y="145" width="10" height="10" fill="#04080f" stroke="rgba(46,230,246,0.9)" />
      <rect x="347" y="233" width="10" height="10" fill="#04080f" stroke="rgba(139,166,193,0.9)" />
      <circle cx="334" cy="194" r="2" fill="rgba(46,230,246,0.6)" />

      {/* Libration arc at the upper mass */}
      <path
        d="M316 150 A 46 46 0 0 1 288 176"
        fill="none"
        stroke="rgba(255,200,87,0.55)"
        strokeDasharray="2 4"
      />

      {/* Trajectory tick marks around the ellipse */}
      <g fill="rgba(46,230,246,0.5)">
        <circle cx="104" cy="140" r="1.9" />
        <circle cx="141" cy="86" r="1.9" />
        <circle cx="205" cy="66" r="1.9" />
        <circle cx="268" cy="78" r="1.9" />
        <circle cx="322" cy="116" r="1.9" />
        <circle cx="163" cy="286" r="1.9" />
        <circle cx="252" cy="308" r="1.9" />
      </g>
    </svg>
  );
}

function ModelCard({ id }: { id: string }) {
  const model = MODELS.find((m) => m.id === id);
  if (!model) return null;
  const unavailable = model.status !== "IMPLEMENTED";
  return (
    <article className={`landing-card${unavailable ? " landing-card-quiet" : ""}`}>
      <header className="landing-card-head">
        <span className="landing-card-id mono">{model.id}</span>
        <StatusBadge outcome={model.status} />
      </header>
      <h3 className="landing-card-title">{model.name}</h3>
      <p className="landing-card-body">{unavailable ? model.statusRationale ?? model.summary : model.summary}</p>
      <footer className="landing-card-foot mono">
        {model.family.replace(/_/g, " ").toLowerCase()} · v{model.version}
      </footer>
    </article>
  );
}

export function Landing({
  onEnterLaboratory,
  onOpenVerification,
  onOpenEvidence,
  onOpenRegistry,
  onOpenReconstruction,
  onOpenAbout,
  runCount,
}: {
  onEnterLaboratory: () => void;
  onOpenVerification: () => void;
  onOpenEvidence: () => void;
  onOpenRegistry: () => void;
  onOpenReconstruction: () => void;
  onOpenAbout: () => void;
  runCount: number;
}) {
  const counts = evidenceStatusCounts();
  const implemented = MODELS.filter((m) => IMPLEMENTED_MODEL_IDS.includes(m.id));
  const unavailable = MODELS.filter((m) => !IMPLEMENTED_MODEL_IDS.includes(m.id));

  return (
    <div className="landing">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-eyebrow mono">
            {APP_CLASSIFICATION} · {APP_RELEASE_LABEL} · v{APP_VERSION}
          </div>
          <h1 className="landing-title">{APP_NAME}</h1>
          <p className="landing-lede">
            A browser-based research prototype for two-body orbital mechanics and bounded tether
            dynamics. Every figure in the application is computed locally by the same engine its
            model-level checks exercise — nothing is fetched over a network and no value is printed
            from an expected-output table.
          </p>

          <div className="landing-proto" role="note" aria-label="Research prototype disclaimer">
            <span className="landing-proto-mark">RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE</span>
            <span className="landing-proto-note">{DISCLAIMER_REST}</span>
          </div>

          <div className="landing-cta">
            <button type="button" className="btn primary" onClick={onEnterLaboratory}>
              Enter the laboratory
            </button>
            <button type="button" className="btn" onClick={onOpenVerification}>
              Review the verification record
            </button>
            <button type="button" className="btn ghost" onClick={onOpenEvidence}>
              Evidence register
            </button>
            <button type="button" className="btn ghost" onClick={onOpenAbout}>
              Scope statement
            </button>
          </div>
          <p className="landing-cta-note muted">
            No account, no sign-in and no server: runs are held in this browser only
            {runCount > 0 ? ` (${runCount} stored in this browser)` : ""}.
          </p>
        </div>

        <div className="landing-hero-art">
          <HeroArt />
          <p className="landing-art-caption mono">
            In-plane geometry · gravity-gradient libration · prescribed length
          </p>
        </div>
      </section>

      <section className="grid cols-4 landing-stats" aria-label="Project figures">
        <Stat
          label="Executable models"
          value={`${implemented.length} of ${MODELS.length}`}
          note="the remaining declarations record explicit gaps rather than hidden approximations"
        />
        <Stat
          label="Model-level checks"
          value={ALL_CHECKS.length}
          tone="cyan"
          note="implementation checks against stated criteria — not physical validation"
        />
        <Stat
          label="Evidence records"
          value={EVIDENCE_REGISTER.length}
          note={`${counts.CONFLICT} conflict(s) and ${counts.UNKNOWN} unknown(s) preserved unresolved`}
        />
        <Stat label="Network egress" value="None" note="no analytics, no telemetry, no external service" />
      </section>

      <Panel
        eyebrow="Scope"
        title="What this build actually computes"
        sub="Two executable models, each with its own governing equations, assumptions, validity limits and declared failure modes."
        actions={
          <button type="button" className="btn ghost sm" onClick={onOpenRegistry}>
            Model registry
          </button>
        }
      >
        <div className="grid cols-2">
          {implemented.map((m) => (
            <ModelCard key={m.id} id={m.id} />
          ))}
        </div>
        <p className="landing-foot-note muted">
          Both models are point-mass gravity only, in the declared reference frame, with the
          numerical method each model documents. No perturbations, no relativity, no atmospheric
          drag, no third-body terms and no distributed tether mass.
        </p>
      </Panel>

      <Panel
        eyebrow="Boundaries"
        title="What it deliberately does not compute"
        sub="These declarations exist so the edge of the implemented physics is visible in the product rather than only in the documentation."
      >
        <div className="grid cols-3">
          {unavailable.map((m) => (
            <ModelCard key={m.id} id={m.id} />
          ))}
        </div>
        <p className="landing-foot-note muted">
          A declared but unimplemented model shows what would be required — equations, inputs and
          evidence — instead of plausible-looking output. Where a required quantity is unknown, it
          stays unknown.
        </p>
      </Panel>

      <Panel
        eyebrow="Method"
        title="How a result is held to account"
        sub="Run records carry their own provenance, and the application is built around one rule: it must calculate the answer, not display the answer that was expected."
      >
        <div className="grid cols-2 landing-account">
          <div className="landing-account-item">
            <h3 className="landing-account-title">Result identity is hashed and scoped</h3>
            <p>
              Each record carries a canonical payload hash with a labelled scope. Numerical results,
              parameters, initial conditions, solver settings, warnings and verification outcomes
              participate in that identity; run id, timestamp and build metadata do not. Records
              written before the scope was introduced keep their legacy scope and are reported as
              such rather than silently re-labelled.
            </p>
          </div>
          <div className="landing-account-item">
            <h3 className="landing-account-title">Evidence carries a status, always</h3>
            <p>
              Every quantitative claim in the register is classified — source-reported, derived,
              assumed, conflicting or unknown. Conflicts are preserved side by side and never
              reconciled silently; unknowns are never filled in with a generic substitute.
            </p>
          </div>
          <div className="landing-account-item">
            <h3 className="landing-account-title">A stored run can be re-executed</h3>
            <p>
              Reproduction re-runs a stored record from its own inputs and compares series, metrics
              and check outcomes within a stated tolerance, so a record can be tested rather than
              trusted. Reproduction compares a run against itself; it is not an external reference.
            </p>
          </div>
          <div className="landing-account-item">
            <h3 className="landing-account-title">Comparison refuses to invent data</h3>
            <p>
              When two runs have different durations or sample counts, the trajectories are reported
              as not computed, with the reason. Nothing is interpolated or resampled to make a
              comparison look complete.
            </p>
          </div>
        </div>
        <Callout title="What hashing and passing checks do not mean" tone="warn">
          Integrity and numerical consistency are not scientific correctness. A matching hash shows
          the payload is unchanged relative to its defined scope and algorithm. A passing check shows
          the implementation behaves as specified against its stated criterion. Neither certifies the
          physics, and no comparison with flight data has been performed in this build.
        </Callout>
      </Panel>

      <Panel
        eyebrow="Case study"
        title="Historical reconstruction workspace"
        sub="TSS-1 and TSS-1R are treated as a scope-limited model comparison, not as a reconstruction of a mission failure."
      >
        <p className="section-intro">
          The workspace runs against sourced geometry from the evidence register, together with
          researcher assumptions that are labelled as assumptions. It requires explicit inputs, stays
          blocked while a required quantity is unknown, and does not model the tether break, arcing or
          electrodynamics. It is not a digital twin and makes no claim about what happened on the
          mission.
        </p>
        <button type="button" className="btn ghost sm" onClick={onOpenReconstruction}>
          Open the reconstruction workspace
        </button>
      </Panel>

      <section className="landing-close">
        <div>
          <div className="landing-proto-mark">RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE</div>
          <p className="landing-close-copy muted">
            Results are limited to the implemented models and documented assumptions. No flight
            qualification and no independent validation is implied.
          </p>
        </div>
        <button type="button" className="btn primary" onClick={onEnterLaboratory}>
          Enter the laboratory
        </button>
      </section>
    </div>
  );
}
