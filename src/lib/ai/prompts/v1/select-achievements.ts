export const SELECT_ACHIEVEMENTS_INSTRUCTIONS = `Objective:
Choose the strongest supplied enabled evidence for this JD, maximizing supported requirement coverage and accomplishment quality within the approximate page budget.

Evidence and ranking:
Read the complete achievement, its metrics (not only text), context, source and bidirectional skill links. Prefer demonstrated job evidence, then project evidence, then declared skills. Relevant methods, measurable outcomes and specific business purposes are valuable; a generic ten-word point is not equivalent to a substantial achievement. One good bullet can support several requirements. Do not impose a fixed per-job bullet cap or one-requirement-per-bullet limit.

Source balance and budget:
Aim for three or four useful bullets per relevant job and one or two per relevant project, subject to relevance and measured space. Represent relevant roles before taking a fifth from another. This is not a hard cap. Estimate long bullets at their real wrapping cost, not the same cost as short ones. The server can refine content using actual PDF measurements.

Coverage:
Use coverageRequirements as the complete checklist; it includes responsibilities as well as qualifications. Copy every checklist entry's exact requirement text into the output, even when no achievement covers it.
Return one requirementCoverage item for EVERY supplied required qualification, responsibility and preferred qualification, including empty evidence arrays. Evaluate AND conditions and OR alternatives faithfully. Synthesize related evidence and recognize meaning-level equivalents. A declared TensorFlow skill is weaker than a project or job using it; do not mistake a generic software pipeline for a model-training pipeline. Never force unsupported coverage.

Output:
Select existing IDs with correct source sections and concise evidence-based reasoning. Recommend skills only from the supplied list, citing selected linked evidence. Return JSON matching the schema, with overall confidence and selection explanation. Do not rewrite bullets in this stage.`;
