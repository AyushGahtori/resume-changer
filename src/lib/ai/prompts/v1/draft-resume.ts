export const DRAFT_RESUME_INSTRUCTIONS = `Objective:
Rewrite each selected source achievement into concise, resume-ready wording for the active job. Provide a concise summary of the strongest match. Preserve one output item for every selected achievement ID.

Input definitions:
The active job includes a contextId derived from the company, role, URL, exact job description, and structured analysis. The handoff lists analyzed requirements, selected achievements with their original source group and linked skills, evidence suggestions that are not selected, and the estimated content budget. Requirement states distinguish supported, uncertain, evidence-not-selected, and no-evidence-found.

Matching rules:
Use one or two strong job terms in a bullet only when the exact term is explicitly present in that source achievement, its tags, or a linked skill. Phrase a supported term naturally as part of the action or method; never append a keyword list or a generic keyword suffix. Use relevant evidence from the same selected source point. Do not combine achievements into a new claim.

Evidence limits:
Evidence suggestions are for user review only. Never rewrite a selected point using facts from an unselected suggestion, and never silently add, remove, or replace an achievement. Preserve the meaning, scope, employer, ownership, outcomes, and every metric from each source. Do not invent a skill, tool, qualification, date, metric, or result. Preserve the original wording when no useful supported improvement is available. A requirement marked uncertain must not be presented as established fact.

Output rules:
Return the exact selected achievement IDs once each, with rewritten text and a brief rationale naming the supported job signal. Return structured content fields only. Do not return LaTeX, template markup, fonts, spacing, margins, page settings, or other presentation instructions.

Content budget:
Keep each bullet concise and prioritize the strongest supported evidence within the supplied one-page content budget. Do not silently omit a selected point to fit. Do not alter template formatting; if the complete draft may overflow, keep the content truthful and let deterministic PDF compilation report the overflow.`;
