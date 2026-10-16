# Resume output quality: implementation plan and work record

## Goal and decisions

Create a strong, nearly full one-page resume from the existing achievement library.
Retain factual detail, metrics, methods, product context and outcomes; improve their
presentation for the active job. Treat the reference resume as the content-density
and accomplishment-writing benchmark. Keep the production template typography fixed.

This document records the diagnosis, the user's October 16 revisions, implementation
progress, verification results and remaining external checks. Private resumes and
diagnostic payloads remain in ignored local storage, not committed test fixtures.

- A requirement-coverage entry is not a resume bullet. One substantial bullet may
  cover several requirements; neither requirements per bullet nor bullets per job
  have a fixed product cap. Application schema safety bounds accommodate the actual
  request; decoder schemas omit array length constraints that Gemini cannot serve.
- Prefer demonstrated job evidence, then project evidence, then declared skills.
  Combine evidence across appropriate resume sections for overall qualifications.
- Three or four substantial bullets per relevant job is a balance preference, not
  a maximum. Represent relevant roles before allocating a fifth elsewhere when
  relevance and space permit. Never add irrelevant content simply to meet a count.
- Bullet selection accounts for information, measurable impact and wrapping cost.
  A generic short point and a substantial achievement do not have equal value/cost.
- Permit related, source-traceable synthesis within the same employer/project.
  Preserve every supporting ID and do not duplicate merged source points in output.
- Permit a disclosed framework inference from a concrete compatible method plus a
  framework already declared in the library, such as CNN plus TensorFlow. Generic
  ML experience alone does not establish a particular framework. Review and coverage
  distinguish this inference from directly recorded project history.
- Validation permits synthesis, aliases and disclosed inferences while preventing
  information loss and invented numerical results. Preserve metric value, unit and
  outcome; do not turn better resource utilization into fewer crashes.
- Use visible word count as an estimate. LaTeX commands do not count as resume
  content; actual PDF text bounds and compiled page count determine final fit.
- Keep two mixed skills rows. Rank relevant individual skills globally, allowing
  useful skills from several original categories to survive.
- Guided Tailor retains explicit approval; Auto Tailor performs selection, drafting
  and measured generation without per-bullet approval and exposes its assumptions.

## Verified diagnosis

The complete supplied recording contains 54 events and the generated PDF hash
matches the recording. The saved JD, analysis and active-job context were consistent.
The problems occurred after evidence loading, rather than during JD persistence.

| Defect                                                  | Consequence                                                              | Required correction                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| AI evidence objects omitted structured metrics          | Quantified outcomes already stored in the library vanished               | Shared complete-evidence builder                      |
| Generic schema shrinking capped coverage at six entries | A 22-requirement JD could receive only six model coverage records        | Request-sized, task-specific schemas                  |
| Word overlap overrode meaning-level evidence            | Valid alternatives were rejected and partial compound matches overstated | Canonical concepts, AND/OR groups and partial states  |
| Coverage ignored education and declared skills          | Real available qualifications appeared missing                           | Typed evidence from all appropriate sections          |
| One-source/one-output contract prohibited synthesis     | The backend contradicted the Task 16 goal                                | Multi-source generated bullets with provenance        |
| Printed summary always used the stored profile          | A drafted summary never reached the PDF                                  | Separate resume summary and generation handoff        |
| Validation checked additions but not omissions          | Metrics, named products and specific methods could disappear             | Preservation checks and item-level source restoration |
| Page estimates were unrelated to actual rendered bounds | The original PDF used about 70% of usable height                         | Bounded compile-and-measure fitting                   |
| Skills selected two original categories                 | Relevant tools were omitted while unrelated languages survived           | Global ranking and two-row packing                    |
| Experience followed library order                       | An older job appeared above the current role                             | Deterministic career-date ordering                    |

All three primary model calls in the recording returned HTTP 503 and used the
configured fallback model. A model change cannot recover facts omitted from inputs.
Existing focused tests passed despite these defects, so new behavioral tests are
required rather than relying on the prior green baseline.

## Implementation checklist

- [x] Pull main and create `codex/task-16-resume-output-quality` from the updated main.
- [x] Carry the existing Task 16 foundation forward and preserve diagnostics work.
- [x] Leave the original diagnostics checkout and its uncommitted changes intact.
- [x] Save a revised plan and maintain this implementation record.
- [x] Build one source-evidence representation with metrics, provenance, context,
      initiative identity and both directions of skill links.
- [x] Include education, credentials and declared capabilities without contact data
      in AI evidence contexts.
- [x] Replace coverage matching with explicit components, AND/OR alternatives,
      semantic terminology, evidence hierarchy and partial/inferred states.
- [x] Preserve every parent requirement; remove six-entry and twenty-draft schema
      transformations that silently reduced request capacity. Keep validation in
      the application while simplifying the provider's decoder schema.
- [x] Track actual provider model, fallback, completion reason and usage when the
      SDK supplies them; reject truncated responses.
- [x] Prefer quantified, specific evidence and balanced relevant role representation;
      charge longer content more space without imposing per-role bullet caps.
- [x] Version prompts and explicitly permit related synthesis and disclosed framework
      inference; require named products, methods, outcomes and metrics to survive.
- [x] Supply an explicit complete requirement checklist and supported JD phrase targets.
      Make one targeted correction attempt for missing phrases; keep the initial
      valid draft if correction fails, and disclose unresolved omissions in review.
- [x] Allow multiple source IDs per bullet, validate source grouping and render merged
      sources once while preserving provenance for each source.
- [x] Repair compressed/lossy drafts and omitted metrics, and restore affected source
      wording for unsupported additions rather than losing every valid proposal.
- [x] Generate and validate an accomplishment-led resume summary separately from the
      selection explanation; retain user approval for summaries in Guided Tailor.
- [x] Render current experience first and pack globally relevant skills into two rows.
- [x] Measure actual PDF text bounds with PDF.js, including font ascent, clipping,
      usable height, bottom gap and visible word count.
- [x] Fit content with at most six compilations; add useful reserve evidence or remove
      low-value complete bullets after overflow while preserving facts in the library.
- [x] Reconcile skill eligibility and summary evidence when fitting changes selection.
- [x] Return the measured PDF and final metadata from one Auto Tailor request.
- [x] Recompute coverage from final rendered bullets/skills and refresh working
      coverage after selection edits; disclose assumptions and source metrics in review.
- [x] Keep encoded PDF bytes out of diagnostics; retain their hash and size.
- [x] Add source, coverage, synthesis, summary, renderer, API, layout and fitting tests.
- [x] Add a local quality workflow for lint, types, unit tests, build and browser tests.
- [x] Make the LaTeX golden fixture independent of Windows/Linux snapshot naming.
- [x] Complete the full browser pass, changed-file formatting, lint, typecheck,
      production build and manual diff/render review.
- [x] Record verification results and prepare the local branch for review.
- [ ] Finish fresh Gemini drafting and 22-requirement selection validation after
      the provider's daily quota resets. Authorization was granted; quota is the blocker.

## Interfaces and behavior

### Evidence and coverage

The library's existing format remains valid. Achievement `initiativeId` and context
are optional additions; existing metric IDs, source evidence and skill IDs are reused.

Selection and drafting receive full metrics and source descriptions. Skill links
are normalized in both directions so evidence is not lost because only one side
records the relationship. Disabled achievements never become eligible through a link.

Coverage keeps original requirement text and IDs, with evidence records identifying
job/project/skill/education/credential, source ID, quotation, inclusion and inference.
States distinguish supported, partial, uncertain, available-but-omitted and missing.
An ongoing degree is partial evidence for a completed-degree requirement. Generic
container monitoring does not establish drift monitoring, and unrelated ML and AWS
facts do not establish deployment of ML models on AWS.

The matcher recognizes canonical technical terms and aliases plus general phrase
matching. It is an auditable heuristic, not an external ATS score or a hiring prediction.
Further domain terminology can be added with regression tests.

### Drafting and rendering

The prompt version is `v2-evidence-quality`. Generated items preserve the legacy
primary achievement ID while optionally citing several source achievement IDs.
Proposal metadata records retained metric IDs, inferred terms and quality notes.
The provider's decoder receives the JSON structure without nested array length
constraints. Request-specific descriptions and prompt checklists describe the
complete output; unchanged application validation enforces capacity and IDs.
This avoids Gemini's "too many states" rejection without reducing requirement or
source counts. A targeted terminology correction is bounded to one additional
drafting attempt, with the existing model fallback policy for each request.

Generated resume summary is a separate field. Existing manual requests remain valid;
approved overrides may contain a summary and source-traceable synthesized bullets.
The renderer suppresses merged secondary bullets and preserves metadata for all sources.

Validation accepts equivalent formatting such as number words/digits and supported
thousands notation. It restores missing structured metrics and source details,
rejects unknown/duplicate sources and cross-group synthesis, and validates summary
claims separately. Compatible framework assumptions remain visible in review.

### Measured generation

Auto Tailor can request full generation through its existing endpoint. The server
selects and drafts, then compiles/measures a bounded series of content arrangements.
The response includes the finalized LaTeX, generation metadata and one-page PDF.
Legacy draft-only clients retain their existing endpoint behavior.

PDF.js measures text rather than counting LaTeX syntax. Target utilization is
approximately 95-98% of usable height with fixed margins and typography. No blank
spacing or irrelevant material is added to force the number. Report underfill or
unavailable measurement honestly when a satisfactory arrangement cannot be found.

Generation metadata includes source provenance, rendered skills, actual word count,
layout measurements, final coverage, fitting attempts and inclusion/removal decisions.
Personal replay artifacts and configuration stay in ignored local directories.

## Test and acceptance plan

Use fictional committed fixtures reproducing the failure structure. Keep the supplied
private recording and PDFs out of fixtures and external test payloads.

Required regressions include:

- Metrics present only in structured fields reach selection, drafting and output.
- Valid metric addition succeeds; altered outcomes, invented numbers and summary
  seniority claims fail or restore source wording.
- Omitted metric, named product and substantial method information is restored.
- One bullet supports multiple requirements; all 22 requirement records survive.
- More than twenty requested draft items retain provider schema capacity.
- AND/OR groups, elliptical supervised/unsupervised phrasing, aliases, partial
  education and framework uncertainty behave distinctly.
- Job evidence ranks ahead of project and declared-skill evidence when comparable.
- Both relevant roles receive meaningful representation before a fifth is allocated;
  adequate space permits more than four bullets from a role.
- Related synthesis preserves every source and renders once; unrelated employers fail.
- Missing supported JD phrases trigger one correction; repeated omissions and quota
  errors terminate safely and leave an explicit review note.
- Final coverage excludes omitted skills and source-only hidden tags.
- User selection edits invalidate prior final coverage and recompute working evidence.
- Generated summary reaches the document only through the correct approval/mode path.
- Two rows retain relevant skills across original categories.
- Underfill, overflow, clipping, absent measurement and exhausted evidence produce
  bounded, understandable results without changing template formatting.
- Fitting removes obsolete unlisted skills and refreshes summary evidence after removal.
- Auto Tailor consumes its compiled response without repeating generation/compilation.
- Diagnostics retain useful trace data without encoded PDF bytes or credentials.

Run changed-file formatting, lint, typecheck, the unit/API suite, relevant and full
Playwright tests, a production build, and the real Tectonic/PDF integration checks.
Review actual rendered output and the diff after the checks pass.

## Verification and work log

- Updated main to `631862b`; created the quality branch and carried the existing
  Task 16 feature as local commit `589403f`.
- Original diagnostics checkout was preserved. Development/testing uses an isolated
  checkout so the original files and staging area are not overwritten.
- Earlier baseline: 61 focused tests passed while the defects remained present.
- Local recorded-response replay improved usable page fill from 69.6% to 97.6%
  in two measured compilations, with no detected clipping. Visible words rose from
  328 to 543 and bottom whitespace fell from 221pt to 17pt. It restored recorded
  metrics and relevant omitted achievements without sending personal data to AI.
- The replay uses recorded model wording where available plus source-based repair
  and additional evidence; it is not a fresh-model quality benchmark.
- Real PDF integration: five checks passed, including actual PDF.js text measurement.
- Replay coverage reports all 22 requirements: six supported, nine partial, two
  with relevant evidence omitted, and five missing. This is an evidence audit,
  not an ATS score; a partial compound requirement is not counted as fully covered.
- Complete native unit/API/PDF suite: 183 passed, three live-provider tests skipped
  in that local command. Tests cover 22 and 300 parent requirements and 25 drafts.
- Full Playwright suite: 32/32 passed. Reviewed the platform-independent LaTeX golden
  update; it includes all ten relevant fixture skills in two mixed rows.
- Lint, typecheck, changed-file Prettier checks, diff whitespace checks and production
  build passed. Inspected the actual final replay page at 150dpi.
- Initial live Gemini validation was blocked by automatic approval review. The user
  then explicitly authorized fictional-only tests; no personal resume or log was sent.
- Live validation exposed Gemini's decoder-state limit. Removed decoder cardinality
  constraints while retaining application limits; live JD analysis subsequently passed.
- Live drafting demonstrated a supported phrase omission. Added explicit phrase
  targets, a single targeted correction, omission notes and mocked regression tests.
- Fresh validation of that correction and the complete 22-requirement pipeline is
  blocked by HTTP 429. The provider reported the daily free-tier limit of 20 requests
  for the configured fallback model and a retry delay of roughly 95 minutes.
- PR #24 was opened for `codex/task-16-resume-output-quality`. The initial GitHub
  quality workflow passed lint, typecheck, all unit tests, the production build and
  browser tests; the real PDF toolchain workflow passed. The separate live Gemini
  workflow failed on the documented provider quota (HTTP 429).
- 2026-10-17: merged the latest `main` into the PR branch, preserved this branch's
  resume-quality and diagnostics changes in the overlapping Task 16 files, and
  retained `main`'s LaTeX validation changes. The merged branch is awaiting fresh CI.

Next verification command after quota reset: `npm run test:ai-live`. It checks JD
analysis, supported terminology plus a structured metric in drafting, and the
production selection/normalization pipeline against all 22 fictional requirements.
Resolve any remaining provider or prose failures before treating external validation
as complete or merging the PR.

## Remaining limits

- Full coverage of an arbitrary JD cannot be guaranteed by formatting or rewriting.
  Missing real qualifications remain visible instead of becoming invented history.
- Framework inferences are disclosed and affect coverage confidence; they are not
  silently converted into confirmed project facts.
- Page fitting can return the best verified underfilled page when useful evidence
  is exhausted. It never fabricates content or changes typography to reach a target.
- The real provider's prose quality for the final correction and expanded selection
  check still need quota-reset validation. Mocked contracts and offline personal
  replay do not substitute for that external test. The live checks deliberately
  fail on provider fallback rather than disguising an external failure as success.
