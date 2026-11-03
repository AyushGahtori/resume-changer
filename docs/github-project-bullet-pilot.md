# Project-bullet pilot: DeepSeek Flash

Repository snapshot `4fc28cd`, 3 November 2026. Internal test only; the application remains configured for Gemini. DeepSeek served `deepseek-flash` with thinking disabled and temperature zero. Each strategy ran once, using the same ordered repository inventory and a 30,000-character source budget split equally between the selected files. This is a preliminary prompt/file-count experiment, not a comparison of the production selector or the complete structured extraction pipeline.

| Variant                | Files | Source characters | Input tokens | Output tokens | Observation                                                                                                                                                                     |
| ---------------------- | ----: | ----------------: | -----------: | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline prompt        |    12 |            28,616 |        8,436 |           655 | Explained the product and drafted six bullets, including infrastructure.                                                                                                        |
| Product-focused prompt |    12 |            28,616 |        8,480 |           591 | First bullet described the end-to-end product and evidence traceability; later bullets covered fallback, PDF fitting and factual integrity.                                     |
| Product-focused prompt |    24 |            28,662 |        8,614 |           862 | Added a distinct requirement-coverage achievement; first bullet described the product and workflow.                                                                             |
| Product-focused prompt |    36 |            29,330 |        9,127 |           506 | Identified JD analysis, selection, PDF fitting and provider resilience, but put the product description outside the bullets and omitted the requested product-led first bullet. |

Representative 24-file opening: “Built a JD-to-resume tailoring workspace that analyzes a job description, selects and rewrites relevant achievements from a user's evidence library, and exports a verified one-page PDF, keeping every tailored line traceable to the user's original work through source-achievement IDs and a review/edit studio.” This is a model draft, subject to verification and attribution review.

The 24-file sample surfaced an additional meaningful capability compared with the 12-file sample, but the 36-file sample did not follow the opening-bullet requirement. One output per variant does not establish a reliable winner. Fixed character slices can cut functions and documentation short, so this experiment cannot establish the best production file limit. The counts and source-character totals are not equivalent to full files read. Numeric claims and ownership remain subject to existing evidence and user review.

Reproduce locally with `node scripts/github-context-quality/deepseek-compare.cjs`. It reads a key from an interactive terminal without echo, or from the `DEEPSEEK_TEST_KEY` environment variable. The key is never written to the repository. The script calls DeepSeek directly for this experiment and is not imported by production code.

## Opening-bullet repair

Three subsequent 36-file generations used the updated production instructions and a JSON response, with thinking disabled. All three put the purpose in the first draft and referenced a claim citing the purpose evidence. One used “tailors” where the purpose field said “tailor”; the application check accepts ordinary inflections. Example:

> Built Resume Changer, a workspace that helps job seekers tailor resumes to job descriptions by organizing source achievements in an evidence library, analyzing each job's requirements, and selecting and rewriting content that stays traceable to the user's actual work.

Input tokens were 10,527 per run; output tokens were 1,630, 1,413, and 1,512. These are three model samples using the same source slices, not proof of semantic correctness or a full test of Google's production provider. The application validates the purpose phrase and purpose-evidence reference, and uses its existing bounded recovery when the check fails. Claim truth and authorship still require evidence review.

Run this focused pilot with `node scripts/github-context-quality/deepseek-compare.cjs --opening-check`.
