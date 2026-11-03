# Researcher Outreach Email

A draft request for an initial technical review. It is written to be sent from the project's
independent developer, addressed to a researcher the owner selects. **No recipient name, address,
or institution is filled in** — those are the owner's to supply, and nothing here implies a prior
relationship, affiliation, endorsement, or partnership.

Replace the single bracketed placeholder with the intended recipient's name before sending. Do not
send without reading `PHASE 3` notes at the end of this file.

---

**Subject:** Request for an initial technical review — independent orbital tether mechanics prototype

Hello [researcher name],

I am an independent developer, working without institutional affiliation, on **Orbital Trace Labs** —
a browser-based computational research prototype for two-body orbital mechanics and, principally,
**orbital tether mechanics**: planar gravity-gradient libration of a tethered dumbbell on a
prescribed length history, coupled one way to a two-body reference orbit.

The purpose of this message is to ask whether you would be willing to give the project an initial
technical review, and to tell me where it is weak. The work has been self-checked to a degree I can
document, but it has never been examined by anyone with aerospace engineering expertise, and I do
not want to keep building on foundations that a specialist would reject in an hour.

To be direct about what this is and is not:

- It is **not flight software**. It is not qualified, certified, or intended for operational use.
- It has **not been physically validated**. No flight data, ground test, or experimental measurement
  has been compared against its output. The two-body model contains no perturbation forces at all.
- It is **not a validated digital twin** and makes no fidelity claim about any real mission.
- It makes no claim of endorsement by, or association with, any agency, university, or researcher.

What it does have is an unusually explicit record of its own limits: every model declares what it
omits, every verification check states its acceptance criterion and its measured value, unresolved
results are reported as unresolved rather than rounded up to a pass, and every quantitative claim is
classified by evidence status (source-reported, derived, assumed, conflicting, or unknown).

If you are willing, the most useful thing would be your view on four questions:

1. Are the governing equations — in particular the prescribed-length libration equation with its
   `2(L̇/L)θ'` term and the local mean motion `n(t)` — formulated correctly?
2. Is fixed-step RK4 with the documented step-refinement evidence an appropriate numerical basis for
   this problem, or does the absence of a symplectic method invalidate the conservation diagnostics?
3. Are the modelling assumptions (planar, massless, rigid, prescribed-length, one-way coupling)
   defensible for the stated scope, and which omitted effect dominates?
4. What would be required before any validation claim could honestly be made, and which step should
   be prioritised first?

The written package is eight short documents; there is a two-page brief that covers the essentials,
so the commitment can be as little as ten minutes. I can send the documents in whatever form is
easiest for you, and I am happy to answer questions or prepare a specific case for you to examine.

An honest negative assessment would be genuinely more useful to me than an encouraging one, and if
your time does not permit this, I quite understand — thank you for reading regardless.

Kind regards,
[Your name]
Independent developer, Orbital Trace Labs

**Project classification:** independent computational research prototype. Not flight software. Not physically validated.

---

## Notes before sending (for the owner, not part of the email)

1. **Placeholders are intentional.** Only the recipient's name appears in brackets. Do not add an
   institutional signature, a university affiliation, or a co-signatory.
2. **Do not attach or claim endorsements.** Nothing in this draft suggests the researcher, their
   employer, or any agency has reviewed, approved, or supported the work.
3. **No funding language** is present, and none should be added.
4. **Attachments are not assumed.** The draft offers to send the package in whatever form is
   convenient; it does not presume an attachment will be opened.
5. **The four questions mirror** §10 of `PROJECT_BRIEF.md` and groups A–H of
   `RESEARCHER_REVIEW_QUESTIONS.md`; if you trim the email, keep at least the first and last.
6. **Do not send from this environment.** Sending is a deliberate action by the owner, outside the
   project.
