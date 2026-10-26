/**
 * Application identity and physical constants.
 *
 * Physical constants are declared with a source reference so that the evidence
 * register (src/evidence/register.ts) can point at the same values. No constant
 * here is derived from the original Orbital Trace Labs project; nothing is
 * imported from a frozen baseline.
 */

declare const __BUILD_ID__: string | undefined;

export const APP_NAME = "Orbital Trace Labs";
export const APP_VERSION = "1.0.0";
export const APP_RELEASE_LABEL = "v1.0-research-prototype";
export const APP_CLASSIFICATION = "Independent Aerospace Research Prototype";

export const DISCLAIMER =
  "RESEARCH PROTOTYPE — NOT FLIGHT SOFTWARE. Results are limited to the implemented " +
  "mathematical models and documented assumptions. No flight qualification or " +
  "independent validation is implied.";

export const BUILD_ID =
  typeof __BUILD_ID__ === "string" && __BUILD_ID__.length > 0 ? __BUILD_ID__ : "unbuilt-dev";

/**
 * Code revision binding status. The bundle carries a build timestamp only; no VCS
 * revision is bound to the artifacts, so provenance cannot claim a verified revision.
 */
export const CODE_REVISION_STATUS = "UNVERIFIED" as const;
export const CODE_REVISION_NOTE =
  "No version-control revision is bound to the built bundle. Build timestamp only. " +
  "Provenance records the code revision as UNVERIFIED.";

/**
 * Earth gravitational parameter.
 * Source: IERS Conventions (2010), Table 1.1, GM(Earth) = 3.986004418e14 m^3/s^2.
 * Evidence record EV-PHY-001.
 */
export const MU_EARTH = 3.986004418e14; // m^3/s^2

/**
 * Earth equatorial radius.
 * Source: WGS-84 defining parameter, a = 6378137 m. Evidence record EV-PHY-002.
 */
export const R_EARTH = 6378137; // m

/** Hard limit on integration steps per propagation, to bound runtime in the browser. */
export const MAX_STEPS = 200_000;
