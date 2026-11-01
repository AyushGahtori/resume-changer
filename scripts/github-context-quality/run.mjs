import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const vitestCli = path.join(
  repositoryRoot,
  "node_modules",
  "vitest",
  "vitest.mjs",
);
const args = parseArguments(process.argv.slice(2));

if (args.help) {
  process.stdout.write(
    [
      "Usage: node scripts/github-context-quality/run.mjs [options]",
      "",
      "Options:",
      "  --adapter <path>   Run an additional adapter module exporting default or qualityAdapter",
      "  --json <path>      Write the machine-readable report",
      "  --markdown <path>  Write the human-readable report",
      "  --help             Show this help",
      "",
    ].join("\n"),
  );
  process.exit(0);
}

if (args.adapter) {
  process.env.GITHUB_CONTEXT_QUALITY_ADAPTER = path.resolve(
    repositoryRoot,
    args.adapter,
  );
}

const temporaryRoot = mkdtempSync(
  path.join(os.tmpdir(), "github-context-quality-"),
);
const jsonReportPath = path.join(temporaryRoot, "report.json");
const testOutput = spawnSync(
  process.execPath,
  [
    vitestCli,
    "run",
    "--config",
    "tests/github-context-quality/vitest.config.ts",
    "--reporter=dot",
  ],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_CONTEXT_QUALITY_REPORT_PATH: jsonReportPath,
      GITHUB_CONTEXT_QUALITY_OFFLINE: "1",
    },
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (testOutput.stdout) process.stderr.write(testOutput.stdout);
if (testOutput.stderr) process.stderr.write(testOutput.stderr);
if (testOutput.error || testOutput.status !== 0) {
  rmSync(temporaryRoot, { recursive: true, force: true });
  process.exit(testOutput.status ?? 1);
}

try {
  const report = JSON.parse(readFileSync(jsonReportPath, "utf8"));
  const markdown = formatMarkdown(report);
  if (args.json) writeOutput(args.json, JSON.stringify(report, null, 2) + "\n");
  if (args.markdown) writeOutput(args.markdown, markdown);
  if (!args.json && !args.markdown) process.stdout.write(markdown);
  if (args.json)
    process.stdout.write(
      "JSON report: " + path.resolve(repositoryRoot, args.json) + "\n",
    );
  if (args.markdown)
    process.stdout.write(
      "Markdown report: " + path.resolve(repositoryRoot, args.markdown) + "\n",
    );
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}

function parseArguments(values) {
  const result = { help: false, adapter: null, json: null, markdown: null };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    const [flag, inline] = value.split("=", 2);
    const next = inline ?? values[index + 1];
    if (flag === "--help") {
      result.help = true;
    } else if (
      flag === "--adapter" ||
      flag === "--json" ||
      flag === "--markdown"
    ) {
      if (!next || next.startsWith("--"))
        throw new Error("Missing value for " + flag);
      result[flag.slice(2)] = next;
      if (inline === undefined) index += 1;
    } else {
      throw new Error("Unknown option: " + value);
    }
  }
  return result;
}

function writeOutput(filePath, content) {
  const absolutePath = path.resolve(repositoryRoot, filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function formatMarkdown(report) {
  const lines = [
    "# GitHub context quality benchmark",
    "",
    "Contract: " +
      report.contractVersion +
      " | Stable report hash: " +
      report.deterministicHash,
    "",
    "Synthetic offline fixtures only. Token counts are character-based estimates; reads are simulated source fetches. Timing and heap deltas are observed and excluded from the deterministic hash.",
    "",
    "## Aggregate results",
    "",
    "| Adapter | Feature coverage | Critical coverage | Overview | Wrapper token share | Test token share | Provenance | Unsafe leaks | Downloaded bytes | Reads | Max retained text | Elapsed ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const strategy of report.strategies) {
    const total = strategy.totals;
    lines.push(
      "| " +
        strategy.adapterId +
        " | " +
        total.featureCoverage.covered +
        "/" +
        total.featureCoverage.total +
        " | " +
        total.criticalFeatureCoverage.covered +
        "/" +
        total.criticalFeatureCoverage.total +
        " | " +
        total.overviewFixtures.present +
        "/" +
        total.overviewFixtures.total +
        " | " +
        percent(total.wrapperTokenShare) +
        " | " +
        percent(total.testTokenShare) +
        " | " +
        total.provenance.correct +
        "/" +
        total.provenance.total +
        " | " +
        total.safeExclusionLeaks +
        " | " +
        total.downloadedBytes +
        " | " +
        total.simulatedRequests +
        " | " +
        total.maxRetainedTextBytes +
        " | " +
        total.totalElapsedMs.toFixed(3) +
        " |",
    );
  }
  lines.push(
    "",
    "## Per-fixture results",
    "",
    "| Adapter | Fixture | Feature coverage | Critical gaps | Files | Tokens | Missing critical features |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- |",
  );
  for (const strategy of report.strategies) {
    for (const fixture of strategy.fixtures) {
      lines.push(
        "| " +
          strategy.adapterId +
          " | " +
          fixture.fixtureId +
          " | " +
          fixture.featureCoverage.covered +
          "/" +
          fixture.featureCoverage.total +
          " | " +
          (fixture.featureCoverage.criticalTotal -
            fixture.featureCoverage.criticalCovered) +
          " | " +
          fixture.selectedFiles +
          " | " +
          fixture.selectedTokenEstimate +
          " | " +
          (fixture.missingCriticalFeatureIds.join(", ") || "none") +
          " |",
      );
    }
  }
  lines.push(
    "",
    "## Public regression manifest",
    "",
    "Revision " +
      report.regressionManifest.revision +
      ": " +
      report.regressionManifest.selectedFiles +
      " files, " +
      report.regressionManifest.selectedLines +
      " selected lines, " +
      report.regressionManifest.selectedBytes +
      " bytes. Three test files account for " +
      report.regressionManifest.testLines +
      " lines. The committed manifest contains paths and counts only.",
    "",
    "Adapter conformance does not prove production wiring or a live provider result.",
    "",
  );
  return lines.join("\n");
}

function percent(value) {
  return value === null ? "—" : (value * 100).toFixed(1) + "%";
}
