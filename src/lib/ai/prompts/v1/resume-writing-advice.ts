// Dropped as not model instructions: channel plugs, livestreams, health asides,
// hiring-season odds, international callback rates, and "do not use AI".
// Dropped because they tell the model to falsify the library: guessing a
// metric, hiding freelance or a second job, stretching dates, renaming a
// company or title, stripping graduation dates, and deleting a real job so
// the person looks newly graduated.

export const RESUME_WRITING_RULES = `Precedence:
These rules govern phrasing, emphasis, and ordering. Shared factuality and the task output contract win on conflict. Style never authorizes a new number, tool, employer, or date, and never authorizes dropping a supplied metric.

Bullet shape:
- Verb, then the concrete tools or methods, then the business effect a non-specialist can understand. A tool with no effect, or an effect with no tool, is incomplete.
- The reader must be able to say what was built or changed, and who could do what because of it. Do not stop at an internal fragment, such as one layer or pipeline step, when the evidence supports the whole system and its purpose.
- Dense jargon with no plain effect fails. Keep a specialized term, and say the effect in ordinary words.
- Keep the supplied problem, purpose, product, method, action, and result. Keep every supplied metric with its unit, outcome, and direction. Attach why that metric mattered. Do not make a year, award date, or count with no work effect the point of the bullet.
- When the source has no number, state the concrete qualitative result that is supplied. Do not invent one.
- Usually 30-50 words when the evidence warrants it. A specific longer point beats a generic short one. Cut filler, not technical detail or outcomes.
- Use a direct verb. Do not inflate ownership. Do not brag or add an unsupported superlative.
- No filler, generic collaboration, or a keyword suffix.
- Do not restate the job title or the obvious duty. Name the software, workflow, or method, and what changed.
- Vague quality words are not results: perfect standards, excellent service, efficiently and effectively, detail-oriented, self-starter, motivated.
- Keep a clear impact sentence. Add a missing supported term into that sentence. Do not replace a good effect just to insert a keyword.
- Put each term in the bullet about the work that used it. Do not put a frontend term in a backend bullet, or the reverse.
- No first person. No "my accomplishments." Do not spend a bullet describing what the company does.

Order and terms:
- The first bullet of a role or project aimed at this job names the target stack. For a specialized role, name the industry or system, then the stack, then the purpose. The opening bullets must read as this role.
- Put nice-to-have and extra-credit tools later in that same role.
- Do not lead with a tool or cloud the job description does not ask for when a supported match exists.
- Put required tools and methods inside the bullet. A skills line does not replace that. If the job asks for explaining technical work to a non-technical person, show that action in a bullet.
- Use about three to six job-description terms in a bullet when the evidence supports them. Do not go past about six. Do not repeat a term in the bullet or across the opening. No keyword list. No invented combined tool name. No leftover instruction text.
- Use the job's name for a tool when the evidence supports that name. Do not add a second name for the same tool unless the job description uses that second name.
- Name a vendor suite only when every named app is in the evidence. Do not repeat the vendor on each app. Do not pair a tool with a generic synonym the job did not ask for.
- Career-sized labels are not skills: visual design, web design, brand design, computer systems, applicant tracking systems. Name the application, workflow, acronym, or method.
- Baseline office tools are not headline skills unless this job description asks for them.
- Spell words correctly.

What to leave out of the wording:
- Soft traits are not a skill list. Attention to detail, communication, deadline management, and team player are expectations. Use one only inside a bullet that shows the action. Leadership needs the scope that is in the evidence.
- No hobbies, interests, references, "references available upon request," objective line, personal motto, quote, or biography.
- Follower counts, typing speed, and side creative work appear only when this job description asks for them and the evidence shows a work outcome. Unrelated personal-brand claims stay out.
- Do not spend summary or bullet space on high school when a degree is in the evidence. Do not describe a degree as a GED.

Summary:
- When the task asks for resumeSummary, write roughly 45-65 words in two sentences: who they are, what they have done, their expertise, and the kind of work they are aimed at. "Hoping to learn and grow" with no field is not a direction.
- The summary must describe the same work as the selected roles. Do not summarize a different career than the bullets.
- One strongest supported metric is allowed. Do not open with a years-of-experience count. Do not put a keyword list or an objective in the summary.`;

export const RESUME_SELECTION_RULES = `Precedence:
These rules govern which supplied evidence to prefer and how to order it. Shared factuality and the task output contract win on conflict. Do not invent evidence. Do not delete library records.

Selection:
- Prefer evidence that can show the target stack in a bullet over a generic duty.
- Put the evidence that makes this resume read as the target role before unrelated roles, even when an unrelated job is more recent.
- A real project in the library, including a school or course project, outranks an empty or unrelated job when that project shows the target stack.
- Give more bullets to the most relevant recent role. Do not leave a substantial recent role as one or two generic bullets when more distinct supplied evidence exists.
- For a multi-year relevant role, prefer about three bullets when the evidence exists. Combine two thin bullets about the same work rather than keeping both weak.
- Older or off-target roles get fewer bullets. Relevance to this job beats a fixed 5-4-3-2-1 ladder. When an older role matches this job better than the latest role, the older role gets more bullets.
- Keep the task budget: about three or four bullets for a relevant job and one or two for a relevant project. This is not a hard cap.
- Do not select hobbies, references, expected-of-everyone soft skills, or an unrelated certificate ahead of work that matches the job.
- Follower counts, typing speed, and similar extras are selectable only when this job description asks for them.
- Work older than about ten years, or older than about five when it is not senior and not relevant to this job, ranks below newer relevant evidence.
- Unrelated early jobs rank below relevant work. Leave them in the library.`;
