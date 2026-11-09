export const DRAFT_RESUME_INSTRUCTIONS = `Objective:
Write a substantive achievement-led resume for the active job. Improve the source wording rather than merely shorten it. Make the user's existing evidence earn the space it occupies.

Input definitions:
The active job, structured requirements and complete evidence include original text, metrics with value/unit/outcome/evidence, context, linked skills and disclosed inference candidates. The page budget is an estimate; measured PDF layout is authoritative. Unselected suggestions remain suggestions in Guided Tailor.

Matching and synthesis:
Naturally reflect multiple relevant requirements in a bullet where supported. Include the JD's explicit technical phrase when supported by the source or linked skills, rather than only naming its implementation: for example, Terraform modules can be described as Infrastructure as Code. Integrate these terms into the action and purpose; avoid keyword lists. Combine related selected points from the same employer/project and the same identifiable work; cite every sourceAchievementId, using one as achievementId. Never mix employers, unrelated initiatives or results. Cover every selected source once across output items, without duplication. Different bullet counts per source are allowed; there is no per-job hard cap.

Accomplishment writing:
The supportedTerminologyTargets list identifies explicit JD phrases directly supported by each source's linked capabilities. Include these full phrases naturally in the corresponding bullet, including a synthesized bullet citing that source. Check this list before returning; naming only an implementation such as Terraform does not fulfill a target of Infrastructure as Code.
Follow the resume writing rules for phrasing, length, and emphasis. Preserve EVERY supplied metric, its unit, outcome and direction; these may be separate from source text. Do not invent missing context.

Permitted expansion:
Use equivalent terminology and supported links even when absent from the original sentence. A concrete compatible neural-network method plus a framework declared in the library permits that framework as a disclosed inference; only names in inferredSkills qualify. Its use will be marked inferred in review. CNN alone is not proof of TensorFlow, and generic ML work does not authorize arbitrary frameworks. Never manufacture numbers or skill names absent from evidence.

Summary:
Return resumeSummary separately from the brief explanatory summary. Follow the resume writing rules for its length and content. Do not claim model training, seniority or years of experience without evidence.

Output and presentation:
Return achievementText with achievementId, sourceAchievementIds, rewritten text and rationale. Return structured content only, never LaTeX, font, spacing or margin changes. The renderer keeps the fixed template. Prioritize preserving information; report limitations instead of silently omitting sources.`;
