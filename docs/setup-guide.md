# Setup Guide: Real Gemini Usage And Future DeepSeek Support

This is the complete v1 setup guide. Follow it from a clean checkout to a
generated resume built from your own data. It assumes you are not a developer
of this repository, and it never requires reading source code.

The guide is organised so that you can stop after any section and still have a
working application. Sections 1 to 4 are enough to run the app; section 5
enables PDF output; section 6 explains what the AI calls cost; section 7
explains how to add another provider such as DeepSeek.

For the shorter developer-oriented setup summary, see
[local setup](local-setup.md). For how the application is put together, see
[architecture](architecture.md).

## Contents

1. [What You Need Before You Start](#1-what-you-need-before-you-start)
2. [Install the Application](#2-install-the-application)
3. [Get a Gemini API Key](#3-get-a-gemini-api-key)
4. [Configure Your Environment](#4-configure-your-environment)
5. [Install the PDF Toolchain](#5-install-the-pdf-toolchain)
6. [Run the Application](#6-run-the-application)
7. [Generate Your First Resume](#7-generate-your-first-resume)
8. [Keep Your Private Data Out of Git](#8-keep-your-private-data-out-of-git)
9. [Cost And Token Behavior](#9-cost-and-token-behavior)
10. [Troubleshooting](#10-troubleshooting)
11. [Adding Another Provider Later](#11-adding-another-provider-later)

## 1. What You Need Before You Start

| Requirement          | Version                      | Why it is needed                              | How to check                             |
| -------------------- | ---------------------------- | --------------------------------------------- | ---------------------------------------- |
| Git                  | any recent release           | Clones the project                            | `git --version`                          |
| Node.js              | `>=22.13.0` (24 recommended) | Runs the Next.js server and the test suite    | `node --version`                         |
| npm                  | ships with Node.js           | Installs dependencies                         | `npm --version`                          |
| Tectonic             | `0.14.1` or newer            | Compiles the LaTeX resume into a PDF          | `tectonic --version`                     |
| Poppler (`pdfinfo`)  | any recent release           | Verifies the compiled PDF is exactly one page | `pdfinfo -v`                             |
| Google AI Studio key | free tier is enough to start | Authenticates the Gemini calls                | see [section 3](#3-get-a-gemini-api-key) |

Node.js 24 is recommended because the page-fill measurement uses PDF.js, which
is only fully supported on newer Node.js releases.

The AI key and the PDF toolchain are independent of each other. You can run the
application and browse your library with no key at all; you only need the key
for JD analysis, AI suggestions, and AI drafting, and you only need the PDF
toolchain for the "Compile PDF" button.

## 2. Install the Application

```bash
git clone https://github.com/AyushGahtori/resume-changer.git
cd resume-changer
npm ci
```

`npm ci` installs the exact dependency versions recorded in
`package-lock.json`. Use `npm ci` rather than `npm install` for a clean
checkout so that you get the same versions that CI verifies.

## 3. Get a Gemini API Key

1. Open <https://aistudio.google.com/apikey> and sign in with a Google account.
2. Choose **Create API key**, select an existing Google Cloud project or create
   a new one, and copy the generated key. It starts with `AIza`.
3. Store the key somewhere safe. It is a credential: treat it like a password.

The Gemini API is available on a free tier for individual use in Google AI
Studio. Free-tier access to a given model, its request rate, and its data-use
terms can change at any time, and the free tier is not a service-level
guarantee. Before you send your real resume content to Google, read the current
[Gemini API pricing and data-use terms](https://ai.google.dev/gemini-api/docs/pricing).
Google states that free-tier submitted content may be used to improve Google
products. Use a paid tier, or a Gemini Developer Agreement that covers you, if
that matters for your situation.

The key is used server-side only. The browser never receives it, and the
application never writes it into generated output, exported metadata, or logs.

## 4. Configure Your Environment

Copy the example environment file and edit it:

```bash
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

`.env.local` is ignored by Git, so your key cannot be committed by accident.
`.env.example` is tracked and must never contain a real key.

The file has three settings:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=replace-with-your-google-ai-studio-api-key
GEMINI_MODEL=gemini-3.6-flash
```

| Variable              | Required         | Default              | Meaning                                                                                                                                                                        |
| --------------------- | ---------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AI_PROVIDER`         | no               | `gemini`             | Which AI backend to use. `gemini` calls Google. `mock` returns fixed local responses and never touches the network. Any other value is rejected at startup with a clear error. |
| `GEMINI_API_KEY`      | yes for `gemini` | none                 | Your Google AI Studio key. When it is empty, the application reports a `MISSING_API_KEY` error instead of failing silently.                                                    |
| `GEMINI_MODEL`        | no               | `gemini-3.6-flash`   | The model used for every AI operation. Any model that supports structured JSON output works.                                                                                   |
| `RESUME_LIBRARY_ROOT` | no               | auto-detected        | The folder that contains your `data/` directory. See [section 8](#8-keep-your-private-data-out-of-git).                                                                        |
| `TECTONIC_BINARY`     | no               | `tectonic` on `PATH` | Full path to the Tectonic executable when it is not on `PATH`.                                                                                                                 |
| `PDFINFO_BINARY`      | no               | `pdfinfo` on `PATH`  | Full path to `pdfinfo` when it is not on `PATH`.                                                                                                                               |

Two optional settings are worth knowing about.

**`AI_PROVIDER=mock`** runs the entire application with no API key and no
network access. The mock provider returns a well-formed but empty analysis, so
JD analysis, "Suggest points", Guided Tailor, and Auto Tailor produce no
recommendations. Manual generation, LaTeX rendering, PDF compilation, the
achievement library, and history all work normally. Use it to confirm that
everything except the AI is healthy, and to run the test suite without spending
credits.

**`GEMINI_MODEL`** applies to every operation. If the model you selected is
unavailable for your account, the application automatically retries once with
`gemini-2.5-flash-lite` and reports a fallback in the server log. If you set
`GEMINI_MODEL=gemini-2.5-flash-lite` explicitly, no fallback is attempted
because that model is already the fallback.

Restart the development server after changing any environment value. Next.js
reads `.env.local` at startup only.

## 5. Install the PDF Toolchain

The application compiles LaTeX locally with
[Tectonic](https://tectonic-typesetting.github.io/book/latest/installation/)
and verifies the page count with Poppler's `pdfinfo`. Both must be installed
and reachable.

### 5.1 Install Tectonic

<details>
<summary>Windows</summary>

Download the `tectonic-*-x86_64-pc-windows-msvc.zip` release from
<https://github.com/tectonic-typesetting/tectonic/releases>, extract it, and
either:

- copy `tectonic.exe` into a directory that is already on `PATH`, or
- keep it where it is and point the application at it:

```dotenv
TECTONIC_BINARY=C:/Program Files/Tectonic/tectonic.exe
```

Use forward slashes and an absolute path. The value is passed straight to the
process launcher, which does not understand Windows backslash escapes.

</details>

<details>
<summary>macOS</summary>

```bash
brew install tectonic
```

</details>

<details>
<summary>Linux</summary>

```bash
sudo apt-get install tectonic
```

The official pinned release used by CI is `0.14.1`:

```bash
version=0.14.1
curl -fsSL -o tectonic.tar.gz \
  "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${version}/tectonic-${version}-x86_64-unknown-linux-musl.tar.gz"
tar --extract --gzip --file tectonic.tar.gz
sudo install -m 0755 tectonic /usr/local/bin/tectonic
```

</details>

Confirm it works:

```bash
tectonic --version
```

### 5.2 Install Poppler (`pdfinfo`)

<details>
<summary>Windows</summary>

Poppler for Windows is distributed as a build bundle rather than a Windows
installer. Download a release from
<https://github.com/oschwartz10612/poppler-windows/releases>, extract it, and
add the `Library\bin` folder that contains `pdfinfo.exe` to `PATH`, or set:

```dotenv
PDFINFO_BINARY=C:/path/to/poppler/Library/bin/pdfinfo.exe
```

</details>

<details>
<summary>macOS</summary>

```bash
brew install poppler
```

</details>

<details>
<summary>Linux</summary>

```bash
sudo apt-get install --yes poppler-utils
```

</details>

Confirm it works:

```bash
pdfinfo -v
```

### 5.3 Warm the Tectonic Package Cache

This step matters and is easy to miss. The compiler runs with Tectonic's
`--only-cached` flag, which forbids network access during compilation. That is
a deliberate safety property: a resume compile never reaches the internet, and
a compromised document cannot pull resources from it.

The consequence is that the LaTeX packages the template needs must already be
in Tectonic's local cache. On a brand-new machine that cache is empty, and the
first compile fails with an error like:

```text
error: failed to open input file "tectonic-format-latex.tex"
```

Warm the cache once with a network-enabled compile, using the same template
the application uses:

```bash
npm run test:pdf-live
```

`npm run test:pdf-live` compiles the real sample resume with the exact flag set
the application uses, so it warms the cache and verifies the whole toolchain at
the same time. It fails with a clear message if Tectonic or `pdfinfo` is
missing rather than reporting a skipped pass.

If you prefer to warm the cache by hand, run Tectonic once **without**
`--only-cached` on any document that uses the template's packages:

```bash
tectonic --untrusted --keep-logs --outdir . some-resume.tex
```

On Windows the cache lives in
`%LOCALAPPDATA%\TectonicProject\Tectonic\cache`. On macOS and Linux it lives
in `~/.cache/Tectonic`. If the cache directory is ever cleared, warm it again
with the command above.

## 6. Run the Application

```bash
npm run dev
```

Open <http://localhost:3000>. Stop the server with `Ctrl+C`.

For a production build:

```bash
npm run build
npm run start
```

The left sidebar has five destinations: **Job description**, **Achievement
library**, **Resume builder**, **History**, and **Settings**. The theme
control in the top bar switches between light and dark mode and remembers your
choice in the browser.

## 7. Generate Your First Resume

The workflow has five screens. You can complete a full cycle in either
direction: the library and the builder are two views of the same data.

### 7.1 Prepare Your Data

The library screen is the source of truth. It reads
`data/resume-library.json` from the local-only `data/` directory. If that file
is missing or invalid, the app shows a clear error and offers the fictional
demo library instead of silently substituting demo content for your own.

To try the application without writing your own data, open
<http://localhost:3000/library?source=demo>. The demo library is fictional
sample data with a fictional candidate, "Jordan Example". It is safe to
generate, export, and experiment with.

For your own data, edit `data/resume-library.json`. The schema is described in
[section 8](#8-keep-your-private-data-out-of-git) and enforced by the
application's validators. You can also create and edit achievement points
directly in the app, which writes the same file with a backup.

### 7.2 Enter the Job Description

Open **Job description**. Fill in the company, role title, and job description.
The description is required and limited to 30,000 characters. The screen shows
a character count and a rough token estimate (characters divided by four).
The draft is saved to your browser automatically, so a page reload restores it.

### 7.3 Analyze the Job

Press **Analyze job description**. The app sends the description to Gemini and
shows the structured result: target title, seniority, explicit requirements,
preferred qualifications, responsibilities, tools, domain concepts, ATS terms,
and inferred context. The analysis is cached in the browser and is tied to that
exact job description. If you edit the description, the analysis is cleared and
must be run again.

### 7.4 Build the Resume

Open **Resume builder**. Choose the data source at the top (your data or the
fictional demo data), then pick achievements. Three AI-assisted entry points
are available, and they are deliberately distinct:

- **Suggest points** asks Gemini which of your enabled points relate to the
  analyzed job, with a rationale for each. Review the suggestions and apply
  the ones you want.
- **Guided Tailor** rewrites the wording of the points you already selected.
  It shows the original text next to the proposed text, the JD terms the
  proposal adds, and the evidence behind each change. Nothing is applied until
  you accept it. The original wording is always recoverable.
- **Auto Tailor** does the whole thing without per-point approval: it
  analyzes, selects, drafts, renders, and measures the page in one request. It
  reports clearly what it did, including when it fell back to the original
  wording because the AI was unavailable.

You can also skip the AI entirely and select points by hand, then press
**Generate LaTeX**.

### 7.5 Compile, Preview, and Export

Press **Create PDF**. The app validates the LaTeX, compiles it with Tectonic,
checks the page count with `pdfinfo`, and measures the visible page fill with
PDF.js. A result that is not exactly one page is reported as a failure with a
diagnostic; the template typography is never shrunk to make content fit.

The builder shows the LaTeX, a PDF preview, and the export controls. Export
produces a `.zip` containing the `.tex`, the `.pdf` when one was generated, and
a `.metadata.json` file that records the JD identity, timestamp, selected
achievement IDs, the AI provider that was used, and the validation, repair,
and page-fitting status. The metadata never contains your API key or internal
logs.

**History** records every saved generation on this machine, with the company,
role, date, selected achievement IDs, provider, and status. You can reopen a
previous generation or delete it.

## 8. Keep Your Private Data Out of Git

### 8.1 What Is Ignored

`.gitignore` excludes `.env*` (except `.env.example`), `/data/`, and
`/storage/`. Your API key, your personal resume library, the library backup,
the generation history, and every generated `.tex` and `.pdf` stay on your
machine.

The only tracked data file is `examples/sample-resume-library.json`, which is
fictional. The rule for the repository is simple: **the tracked examples and
the automated test fixtures are always fictional, never your real resume.**
Use clearly synthetic data in anything you commit.

### 8.2 Where Your Data Lives

| Path                                  | Contents                                  | Tracked?    |
| ------------------------------------- | ----------------------------------------- | ----------- |
| `data/resume-library.json`            | Your personal resume library              | No, ignored |
| `data/resume-library.json.bak`        | Automatic backup written before each save | No, ignored |
| `data/generation-history.json`        | Saved generation history                  | No, ignored |
| `data/generations/`                   | Generated `.tex` and `.pdf` artifacts     | No, ignored |
| `examples/sample-resume-library.json` | Fictional demo library                    | Yes         |

### 8.3 The Library File Format

`data/resume-library.json` is validated by the application on every load. A
file that does not match the schema is rejected with a message naming the
offending path, and the app never falls back to demo data on its own. The
structure is:

```json
{
  "schemaVersion": 1,
  "profile": {
    "id": "profile-owner",
    "fullName": "Your Name",
    "summary": "One or two lines describing your focus.",
    "education": [
      {
        "id": "education-undergrad",
        "institutions": ["Example University"],
        "degree": "B.Tech",
        "fieldOfStudy": "Computer Science",
        "startDate": "2019-08",
        "endDate": "2023-06"
      }
    ]
  },
  "jobs": [
    {
      "id": "job-example",
      "company": "Example Systems",
      "title": "Software Engineer",
      "employmentType": "full-time",
      "startDate": "2023-07",
      "endDate": null,
      "points": [
        {
          "id": "achievement-example",
          "text": "Built a deployment workflow that cut release time from two hours to ten minutes.",
          "tags": ["ci-cd"],
          "skillIds": ["skill-aws"],
          "metrics": [
            {
              "id": "metric-release-time",
              "label": "Release time",
              "value": "10 minutes",
              "evidence": "Internal release dashboard, March 2024"
            }
          ],
          "source": { "type": "direct-user" },
          "enabled": true
        }
      ]
    }
  ],
  "projects": [],
  "skills": [
    {
      "id": "skill-aws",
      "name": "AWS",
      "aliases": ["Amazon Web Services"],
      "sources": ["direct-user"],
      "isListedOnCurrentResume": true,
      "evidenceAchievementIds": ["achievement-example"]
    }
  ],
  "credentials": [],
  "preferences": {
    "sectionOrder": [
      "experience",
      "projects",
      "education",
      "skills",
      "credentials"
    ],
    "maxPages": 1
  }
}
```

Rules the validator enforces, all of which matter for truthfulness:

- Every ID is unique across the whole file and uses lowercase letters, digits,
  and hyphens.
- Dates are `YYYY-MM`. A job's end date is `null` while it is current, and
  cannot be earlier than its start date.
- A metric must carry `evidence`. A metric without a supporting source is
  rejected, so unsupported numbers cannot enter the library.
- A point's `skillIds` must reference skills that exist, and a skill's
  `evidenceAchievementIds` must reference points that exist.
- `maxPages` is exactly `1`. One page is a hard product limit.
- Skills are stored separately from whether they appear on the current resume.
  A skill with `isListedOnCurrentResume: false` is a real skill of yours that
  the AI may add to a tailored resume when the evidence supports it.

### 8.4 Working From Multiple Checkouts or Worktrees

Git does not copy ignored files into a new clone or a linked worktree, so a
second checkout starts without your library. The application handles this: when
the running checkout has no `data/resume-library.json`, it automatically looks
for the primary checkout's copy and uses it, including its backups and
generation history. A library present in the current checkout always takes
precedence, even if it is invalid and needs repair.

To point the application at a different location, set `RESUME_LIBRARY_ROOT` to
the folder that contains `data/`:

```dotenv
RESUME_LIBRARY_ROOT=C:/path/to/resume-changer
```

This explicit setting disables automatic discovery entirely, so if the
configured file is missing you get a clear "not found" error instead of a
surprise. Demo mode always reads the fictional example from the running
checkout, regardless of this setting.

### 8.5 Before You Commit

```bash
git status --short
git diff
```

Check that no file under `data/`, `storage/`, or with a `.env` name appears in
the output. If it does, do not stage it. The `.gitignore` rules cover the
normal cases, but a file added with `git add -f` bypasses them.

## 9. Cost And Token Behavior

### 9.1 What Sends Data to Google

Only these actions contact the Gemini API:

| Action                            | Endpoint                               | What is sent                                                                        |
| --------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| Analyze job description           | `POST /api/ai/analyze-job-description` | The job description, company, and role title                                        |
| Suggest points                    | `POST /api/ai/select-achievements`     | The job description, the analysis, and your achievement and skill evidence          |
| Guided Tailor                     | `POST /api/ai/tailor-achievements`     | The job description, the analysis, and the selected points                          |
| Auto Tailor                       | `POST /api/ai/auto-tailor`             | The same inputs, plus the structured handoff, and possibly a bounded repair request |
| Imagination (achievement writing) | `POST /api/ai/achievement`             | The draft text, the connected skills, and the source constraints                    |

Everything else is local. LaTeX rendering, PDF compilation, page measurement,
the achievement library, history, and export never call an external service.

Note what is **not** sent: the filled-in resume LaTeX and the production
template source. The model receives structured content and returns structured
content. The deterministic renderer owns the template.

### 9.2 How Many Calls a Job Takes

A complete Auto Tailor run makes between one and three model calls:

1. **Analysis.** One call. The job description in, the role signals out.
2. **Selection and drafting.** Normally one call for selection and one for
   drafting. The selection call may be retried once with a fallback model.
3. **Optional repair.** Only when the rendered content overflows by at most 40
   words. The repair is capped at one attempt, and it is rejected if it changes
   the selected evidence or does not actually shorten the text.

The drafting step can also make one targeted correction call when the model
omits a JD phrase that the evidence directly supports. That correction is
bounded, and the original draft is kept if the correction does not help.

In practice, a full Auto Tailor run for one job description costs roughly two
to four model requests, and a Guided Tailor run that reuses an existing
analysis costs one or two.

### 9.3 What Determines the Price

Gemini bills on tokens. The token count of a request is dominated by the
evidence you send:

- **The job description.** Capped at 30,000 characters.
- **Your achievement library.** The full evidence set for the points that are
  enabled and relevant, plus your skill records. This is usually the largest
  part of the request.
- **The prompt instructions.** Fixed per operation and versioned separately
  from your data.

A large library therefore costs more per request than a small one. The
application sends a bounded context and refuses to send a request larger than
its size limit, reporting an `INPUT_TOO_LARGE` error rather than silently
truncating your evidence. If you hit that limit, disable the points you do not
need, which is also the honest thing to do, because disabled points are not
sent.

The token counter in the job description box is a local estimate of the
description's size only. It is not a cost estimate for the whole request, and
it is not a bill.

### 9.4 Practical Guidance

- **Use `AI_PROVIDER=mock`** for all UI exploration and for the test suite. It
  makes no network request and costs nothing.
- **Reuse one analysis.** The analysis is cached per job description in the
  browser. Changing the description invalidates it, and re-running it costs
  another call.
- **Batch your work.** Because a request carries the whole library, reviewing
  and refining one job description before moving to the next is cheaper than
  iterating across many.
- **Watch the free-tier limits.** Free-tier request and token rates vary by
  model and by project, and they change. When the limit is hit, the app
  reports a `RATE_LIMITED` error, and the local fallback keeps your source
  wording intact so you can continue working.

## 10. Troubleshooting

### Gemini Problems

**"Set GEMINI_API_KEY in .env.local or choose AI_PROVIDER=mock."**
The key is missing or empty. Confirm that `.env.local` exists in the directory
you are running from, that the line is `GEMINI_API_KEY=AIza...` with no
surrounding quotes, and that you restarted the dev server.

**"Gemini rejected the API key or its permissions." (`AUTHENTICATION_FAILED`)**
The key is wrong, revoked, or the Google Cloud project does not have the
Generative Language API enabled. Open the API key in AI Studio and check that
it is active, and enable the API for the linked project.

**"Gemini's free-tier request limit was reached." (`RATE_LIMITED`)**
You have hit the current quota for the model. Wait for the quota window to
reset, use a different model with `GEMINI_MODEL`, or enable billing on the
project.

**"Gemini did not respond before the request timed out." (`REQUEST_TIMEOUT`)**
The request took longer than 30 seconds, which usually means a very large
evidence set. Reduce the number of enabled points and retry.

**"Gemini returned an incomplete or inconsistent response." (`INVALID_RESPONSE`)**
The model returned JSON that did not match the expected schema, or the output
was truncated because it hit the output token limit. The app automatically
retries once with `gemini-2.5-flash-lite`. If it persists, the evidence set is
probably too large; disable the points you do not need.

**"The selected resume context is too large to send." (`INPUT_TOO_LARGE`)**
The request exceeded the application's prompt size limit. Reduce the library
size or the job description length.

**"Unsupported AI_PROVIDER value"**
`AI_PROVIDER` must be `gemini` or `mock`. Any other value is rejected at
startup.

**The model you selected is not available for your account**
The app falls back to `gemini-2.5-flash-lite` once and logs the fallback. Set
`GEMINI_MODEL` to a model your account can use.

### PDF Compiler Problems

**"Tectonic was not found. Install Tectonic or set TECTONIC_BINARY to its
executable path."** (`COMPILER_NOT_FOUND`, HTTP 503)
Tectonic is not on `PATH`. Install it, or set `TECTONIC_BINARY` to the full
path of the executable. On Windows use forward slashes.

**"pdfinfo was not found. Install Poppler or set PDFINFO_BINARY to its
executable path."** (`PDF_INFO_NOT_FOUND`, HTTP 503)
Poppler is missing or not on `PATH`. Install Poppler and check that the folder
containing `pdfinfo` is on `PATH`, or set `PDFINFO_BINARY`.

**"error: failed to open input file "tectonic-format-latex.tex""**
The Tectonic package cache is empty. The compiler runs with `--only-cached`,
so it cannot download the template's packages on demand. Warm the cache once
with a network-enabled compile, as described in
[section 5.3](#53-warm-the-tectonic-package-cache).

**"LaTeX validation failed. Fix the reported issues and regenerate the
resume."** (`LATEX_VALIDATION_ERROR`)
The generated LaTeX is structurally invalid, which usually means the content
included characters that broke the template. Check the LaTeX view for
unfinished placeholders or unsupported commands, then regenerate.

**"Tectonic could not compile this LaTeX source."** (`LATEX_ERROR`)
The compiler rejected the document. Expand **Compiler details** in the builder
to see the captured compiler output.

**"This resume must fit on one page; the compiled document has N pages."**
(`PAGE_LIMIT_EXCEEDED`)
The content overflowed. The application normally handles this by measuring the
overflow and shortening or pruning lower-ranked content, up to a six-compilation
limit. When it cannot, reduce the number of selected points or shorten the
longest bullets yourself.

**"LaTeX compilation exceeded the time limit."** (`COMPILE_TIMEOUT`, HTTP 408)
The compile took longer than 30 seconds. This is usually a first-run cache
miss. Warm the cache as in [section 5.3](#53-warm-the-tectonic-package-cache),
then retry.

**The first compile after a fresh install is slow**
Warming the cache downloads the LaTeX bundle. It happens once. Later compiles
use the cache only.

### Data Problems

**"data/resume-library.json was not found."**
Your personal library is not in the running checkout. See
[section 8.4](#84-working-from-multiple-checkouts-or-worktrees) for automatic
discovery and the `RESUME_LIBRARY_ROOT` setting, or use the demo library
explicitly with `?source=demo`.

**"data/resume-library.json does not match the required data schema"**
The file is not valid for this application. The message names the failing path
and the reason, such as `jobs.0.points.1.metrics.0.evidence: Must not be
empty.` Fix the named field. The previous good copy is in
`data/resume-library.json.bak`.

**"data/resume-library.json is not valid JSON"**
There is a syntax error, usually a missing comma or a trailing comma. The
message points at the file, not the line, so check the file with a JSON
validator.

**"Another library save is in progress."**
A write lock is held. Wait a moment and retry. If it persists, a previous
process was killed mid-save; delete the stale `data/resume-library.json.lock`
file.

**"Saved generation history contains invalid JSON."**
The history file was edited by hand or truncated. It was left unchanged so you
can repair it. Fix or move the file at `data/generation-history.json`.

### Application Problems

**Port 3000 is already in use**
Stop the other process, or start on another port with
`npm run dev -- --port 3001`.

**The page shows a stale or empty library**
The app reloads the file on each request, so a change should appear on refresh.
If it does not, confirm the file path with the `RESUME_LIBRARY_ROOT` setting.

**Your analysis disappeared**
The analysis is cached in the browser and is tied to the exact job
description, company, and role title. Editing any of them clears the cache by
design, because a stale analysis must never be mixed into a new draft.

**"The job or analysis changed. Reanalyze the active job first."** (HTTP 409)
The builder detected that the job context no longer matches the analysis.
Return to **Job description**, confirm the description, and run **Analyze job
description** again.

**Playwright cannot find Chromium**
Run `npx playwright install chromium` once per machine before `npm run
test:e2e`.

### Verifying Your Setup

```bash
npm run lint
npm run typecheck
npm test
npm run test:ai-live
npm run test:pdf-live
```

`npm run test:ai-live` sends a synthetic job description to the real Gemini
API. `npm run test:pdf-live` compiles the real sample resume with the real
toolchain. Both fail loudly when their credentials or tools are missing rather
than reporting a skipped pass, so a green run means the whole setup works.

## 11. Adding Another Provider Later

The application talks to AI through one interface, so a new provider is an
adapter, not a rewrite. This section explains the shape of that work for
whoever adds it. You do not need to do this to use the application.

### 11.1 How the Provider Boundary Works

Four modules define the boundary:

| Module                           | Responsibility                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------- |
| `src/lib/ai/provider.ts`         | The `AiProvider` interface and the `AiProviderError` type with its error codes    |
| `src/lib/ai/provider-factory.ts` | Chooses a provider from environment variables                                     |
| `src/lib/ai/gemini-provider.ts`  | The Gemini adapter, including its HTTP call, response parsing, and model fallback |
| `src/lib/ai/mock-provider.ts`    | A deterministic offline provider used by the test suite                           |

The interface has one method per AI operation, plus a `name` field that is
recorded in the generation metadata and the export package:

```ts
export interface AiProvider {
  writeAchievement?(
    operation: import("./achievement-writing").AchievementWritingOperation,
    input: import("./achievement-writing").AchievementWritingInput,
  ): Promise<import("./achievement-writing").AchievementWritingResult>;
  readonly name: "mock" | "gemini";
  analyzeJobDescription(input: JobAnalysisInput): Promise<JobAnalysisResult>;
  selectAchievements(
    input: AchievementSelectionInput,
  ): Promise<AchievementSelectionResult>;
  draftResume(input: ResumeDraftInput): Promise<ResumeDraftResult>;
  repairLatexContent(input: LatexRepairInput): Promise<LatexRepairResult>;
}
```

Everything else in the application depends only on this interface. The route
handlers, the selection logic, the renderer, and the compiler never see a
vendor-specific type. That is what makes the swap safe.

### 11.2 What a New Provider Must Do

A DeepSeek adapter would need to:

1. **Implement the interface.** Return a `name` such as `"deepseek"`, and
   implement the four required methods.
2. **Send the same prompt.** Use `buildAiPrompt(task, input)` from
   `src/lib/ai/prompt-builder.ts`. It assembles the shared instructions, the
   task-specific instructions, and the typed task data into the exact prompt
   the rest of the system expects. Do not write a second prompt builder.
3. **Request structured JSON.** Ask the model for JSON matching the output
   schema that `buildAiPrompt` returns, and parse the response.
4. **Validate before returning.** Parse the response with the Zod schema from
   `src/lib/ai/contracts.ts` and throw an `AiProviderError` with
   `INVALID_RESPONSE` when validation fails. The rest of the application
   already handles that error correctly.
5. **Map failures to the shared error codes.** `MISSING_API_KEY`,
   `AUTHENTICATION_FAILED`, `RATE_LIMITED`, `REQUEST_TIMEOUT`,
   `SERVICE_UNAVAILABLE`, `INVALID_REQUEST`, `INVALID_RESPONSE`,
   `INPUT_TOO_LARGE`, and `REQUEST_FAILED` are what the routes, the fallback
   behavior, and the user-facing messages understand.
6. **Keep the truthfulness rules.** The shared prompt instructions already
   forbid inventing metrics, employers, dates, qualifications, and
   responsibilities. Keep them in place and do not let a new adapter weaken
   them.
7. **Never expose the key.** The adapter runs in server-only code, and the key
   is read from the environment on the server.

### 11.3 Wiring It In

Three small changes connect a new adapter:

1. **Add the adapter module**, for example
   `src/lib/ai/deepseek-provider.ts`, exporting a `createDeepSeekProvider`
   function that returns an `AiProvider`.
2. **Extend the factory** in `src/lib/ai/provider-factory.ts`. The factory
   reads `AI_PROVIDER` and dispatches; add a branch for the new value, read
   its key from the environment, and throw the existing
   `AiProviderError` with `MISSING_API_KEY` when the key is absent. Keep the
   existing unsupported-value error.
3. **Extend the `name` union** in `src/lib/ai/provider.ts` so the new provider
   name type-checks.

Then add the new environment variables to `.env.example` with placeholder
values, and document them in this guide. Because `.env.example` is tracked and
`.env.local` is not, a real key can never reach Git through this path.

### 11.4 Why the Interface Is Shaped This Way

A few properties of the interface are deliberate and worth preserving:

- **The operations are separate.** Analysis, selection, drafting, and repair
  are four methods rather than one "do everything" method, because they have
  different inputs, different budgets, and different failure modes.
- **The model returns content, not LaTeX.** The model never sees or produces
  the template, and never sets presentation. The deterministic renderer owns
  the template, so the one-page format cannot drift.
- **The model never returns presentation or layout settings.** The structured
  contracts have no field for typography, spacing, or margins, which is how the
  template is kept locked between generations.
- **Selection is separated from rewriting.** The selection operation returns
  source IDs; the drafting operation returns wording. A provider that does
  both in one call would break the review workflow.
- **The error codes are a shared contract.** The routes turn them into HTTP
  statuses, and the UI turns them into messages that tell the user what to
  do next. A new adapter that invents its own error shapes will produce
  confusing messages.
- **A mock provider must keep working.** The automated tests depend on a
  provider that returns fixed data with no network access. The new adapter
  needs a matching offline path, or the test suite has to be changed to depend
  on a paid API.

## Related Documentation

- [Documentation index](index.md)
- [Local setup](local-setup.md) - the shorter developer setup summary
- [Architecture overview](architecture.md) - how the pieces fit together
- [Contributing and task workflow](contributing.md) - branch, test, and review rules
- [Project plan](project-plan.md) - the v1 roadmap and product rules
