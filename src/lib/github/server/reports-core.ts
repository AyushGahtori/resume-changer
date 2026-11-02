import { createHash } from "node:crypto";
import {
  err,
  ok,
  GITHUB_IMPORT_POLICY,
  RepositoryPathSchema,
  type DomainErrorCode,
  type EvidenceItem,
  type ExecutionContext,
  type MeasurementAnswer,
  type MeasurementDefinition,
} from "../contracts";
import type { ReportParserPort } from "../ports";
import { GITHUB_BUDGET_LIMITS } from "./budget";

const MAX_REPORT_BYTES = GITHUB_BUDGET_LIMITS.decodedBytesPerBody;
const MAX_REPORT_LINES = GITHUB_BUDGET_LIMITS.sourceLinesPerFilePerRequest;
const MAX_REPORT_ROWS = 100;
const MAX_REPORT_COLUMNS = 32;
const MAX_JSON_DEPTH = 24;
const MAX_JSON_NODES = 10_000;
const MAX_CELL_CHARACTERS = 4_096;
const SHA_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i;
const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const CSV_FORMULA_PATTERN = /^\s*[=+@]/;
const CSV_PREFIX = "\uFEFF";
const REPORT_SCHEMA_VERSION = 1;

/** Extra trusted data supplied by the server alongside the frozen execution context. */
export type ReportSourceContext = {
  fileId: string;
  snapshotId: string;
  commitSha: string;
  path: string;
  blobSha: string;
  expectedProtocol?: string;
};

export type ReportParserDependencies = {
  /** Definitions come from the trusted measurement catalog, never from the report. */
  definitions: readonly MeasurementDefinition[];
  acceptedUnits?: Readonly<Record<string, readonly string[]>>;
};

type ReportExecutionContext = ExecutionContext & {
  reportSource?: ReportSourceContext;
};

type JsonPrimitive = string | number | boolean | null;
type JsonNode =
  | {
      kind: "primitive";
      value: JsonPrimitive;
      raw: string;
      start: number;
      end: number;
    }
  | {
      kind: "object";
      entries: Map<string, JsonNode>;
      start: number;
      end: number;
    }
  | { kind: "array"; items: JsonNode[]; start: number; end: number };
type JsonStringNode = {
  kind: "primitive";
  value: string;
  raw: string;
  start: number;
  end: number;
};
type CsvCell = { value: string; raw: string; start: number; end: number };
type CsvRecord = { cells: CsvCell[]; row: number; start: number; end: number };
type FieldCell = { value: string; raw: string; pointer: string };
type ReportRow = {
  fields: Map<string, FieldCell>;
  pointer: string;
  excerpt: string;
};

const REPORT_FIELDS = [
  "metricId",
  "taskType",
  "value",
  "unit",
  "statistic",
  "revision",
  "reportKind",
  "protocol",
  "workload",
  "environment",
  "runId",
  "toolVersion",
  "dataset",
  "datasetVersion",
  "split",
  "positiveClass",
  "targetUnit",
  "endpoint",
  "startEvent",
  "endEvent",
  "observationWindow",
  "observationPeriod",
  "sampleCount",
  "averagingMode",
  "denominator",
  "toolName",
  "scope",
] as const;

const REQUIRED_REPORT_FIELDS = [
  "metricId",
  "value",
  "unit",
  "statistic",
  "revision",
  "reportKind",
];
const JSON_ROOT_FIELDS = new Set(["schemaVersion", "results"]);
const REPORT_FIELD_SET = new Set<string>(REPORT_FIELDS);

/**
 * Supported v1 JSON reports use { schemaVersion: 1, results: [...] }.
 * CSV reports use schemaVersion, the same result fields as column headers,
 * and one version value in every row. Unknown fields and columns are rejected.
 */

class InvalidReportError extends Error {}
class ReportLimitError extends Error {}

function domainError(code: DomainErrorCode, message: string) {
  return { code, message, retryable: false } as const;
}

function hash(value: string, algorithm: "sha1" | "sha256" = "sha256") {
  return createHash(algorithm).update(value, "utf8").digest("hex");
}

function gitBlobHash(value: string, algorithm: "sha1" | "sha256") {
  const bytes = Buffer.from(value, "utf8");
  return createHash(algorithm)
    .update(Buffer.from(`blob ${bytes.byteLength}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function physicalLineCount(value: string) {
  if (!value) return 0;
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.split("\n").length - (normalized.endsWith("\n") ? 1 : 0);
}

function isSha(value: unknown): value is string {
  return typeof value === "string" && SHA_PATTERN.test(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function safePath(value: unknown): value is string {
  return (
    typeof value === "string" && RepositoryPathSchema.safeParse(value).success
  );
}

function escapePointerPart(value: string) {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function jsonCell(
  node: JsonNode | undefined,
  pointer: string,
): FieldCell | undefined {
  if (
    !node ||
    node.kind !== "primitive" ||
    (typeof node.value !== "string" && typeof node.value !== "number")
  ) {
    return undefined;
  }
  return { value: String(node.value), raw: node.raw, pointer };
}

class StrictJsonReader {
  private index = 0;
  private nodeCount = 0;

  constructor(private readonly input: string) {}

  read(): JsonNode {
    this.skipWhitespace();
    const root = this.value(0);
    this.skipWhitespace();
    if (this.index !== this.input.length)
      throw new InvalidReportError("Unexpected content after JSON report.");
    return root;
  }

  private value(depth: number): JsonNode {
    if (depth > MAX_JSON_DEPTH)
      throw new ReportLimitError("JSON nesting exceeds the parser limit.");
    this.nodeCount++;
    if (this.nodeCount > MAX_JSON_NODES)
      throw new ReportLimitError("JSON report contains too many values.");
    this.skipWhitespace();
    const start = this.index;
    const char = this.input[this.index];
    if (char === "{") return this.object(depth + 1);
    if (char === "[") return this.array(depth + 1);
    if (char === '"') return this.string();
    if (char === "t") return this.literal("true", true);
    if (char === "f") return this.literal("false", false);
    if (char === "n") return this.literal("null", null);
    if (char === "-" || (char >= "0" && char <= "9")) return this.number();
    throw new InvalidReportError("Malformed JSON report.");
  }

  private object(depth: number): JsonNode {
    const start = this.index++;
    const entries = new Map<string, JsonNode>();
    this.skipWhitespace();
    if (this.input[this.index] === "}") {
      this.index++;
      return { kind: "object", entries, start, end: this.index };
    }
    while (this.index < this.input.length) {
      if (entries.size >= MAX_REPORT_COLUMNS * 2)
        throw new ReportLimitError("JSON object contains too many fields.");
      if (this.input[this.index] !== '"')
        throw new InvalidReportError("JSON object keys must be strings.");
      const key = this.string().value as string;
      if (entries.has(key))
        throw new InvalidReportError("JSON report contains a duplicate field.");
      this.skipWhitespace();
      if (this.input[this.index++] !== ":")
        throw new InvalidReportError("Malformed JSON object.");
      entries.set(key, this.value(depth));
      this.skipWhitespace();
      const delimiter = this.input[this.index++];
      if (delimiter === "}")
        return { kind: "object", entries, start, end: this.index };
      if (delimiter !== ",")
        throw new InvalidReportError("Malformed JSON object.");
      this.skipWhitespace();
    }
    throw new InvalidReportError("Unclosed JSON object.");
  }

  private array(depth: number): JsonNode {
    const start = this.index++;
    const items: JsonNode[] = [];
    this.skipWhitespace();
    if (this.input[this.index] === "]") {
      this.index++;
      return { kind: "array", items, start, end: this.index };
    }
    while (this.index < this.input.length) {
      if (items.length >= MAX_REPORT_ROWS)
        throw new ReportLimitError("JSON report contains too many rows.");
      items.push(this.value(depth));
      this.skipWhitespace();
      const delimiter = this.input[this.index++];
      if (delimiter === "]")
        return { kind: "array", items, start, end: this.index };
      if (delimiter !== ",")
        throw new InvalidReportError("Malformed JSON array.");
      this.skipWhitespace();
    }
    throw new InvalidReportError("Unclosed JSON array.");
  }

  private string(): JsonStringNode {
    const start = this.index++;
    let escaped = false;
    while (this.index < this.input.length) {
      const char = this.input[this.index];
      const code = this.input.charCodeAt(this.index);
      if (!escaped && char === '"') {
        this.index++;
        const raw = this.input.slice(start, this.index);
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          throw new InvalidReportError("Malformed JSON string.");
        }
        if (typeof value !== "string")
          throw new InvalidReportError("Malformed JSON string.");
        if (value.length > MAX_CELL_CHARACTERS)
          throw new ReportLimitError("JSON field exceeds the parser limit.");
        return { kind: "primitive", value, raw, start, end: this.index };
      }
      if (!escaped && code < 0x20)
        throw new InvalidReportError(
          "JSON string contains an unescaped control character.",
        );
      if (!escaped && char === "\\") escaped = true;
      else escaped = false;
      this.index++;
    }
    throw new InvalidReportError("Unclosed JSON string.");
  }

  private number(): JsonNode {
    const start = this.index;
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(
      this.input.slice(this.index),
    );
    if (!match) throw new InvalidReportError("Malformed JSON number.");
    this.index += match[0].length;
    const next = this.input[this.index];
    if (next && !",]} \t\r\n".includes(next))
      throw new InvalidReportError("Malformed JSON number.");
    const value = Number(match[0]);
    if (!Number.isFinite(value))
      throw new InvalidReportError("JSON report contains a non-finite number.");
    return { kind: "primitive", value, raw: match[0], start, end: this.index };
  }

  private literal(literal: string, value: boolean | null): JsonNode {
    const start = this.index;
    if (this.input.slice(this.index, this.index + literal.length) !== literal)
      throw new InvalidReportError("Malformed JSON literal.");
    this.index += literal.length;
    return { kind: "primitive", value, raw: literal, start, end: this.index };
  }

  private skipWhitespace() {
    while ([" ", "\t", "\r", "\n"].includes(this.input[this.index] ?? ""))
      this.index++;
  }
}

function parseJsonRows(text: string): ReportRow[] {
  const root = new StrictJsonReader(text).read();
  if (root.kind !== "object")
    throw new InvalidReportError("JSON report root must be an object.");
  for (const key of root.entries.keys())
    if (!JSON_ROOT_FIELDS.has(key))
      throw new InvalidReportError("Unsupported JSON report root field.");
  const schemaVersion = jsonCell(
    root.entries.get("schemaVersion"),
    "/schemaVersion",
  );
  if (schemaVersion?.value !== String(REPORT_SCHEMA_VERSION))
    throw new InvalidReportError("Unsupported JSON report schema version.");
  const results = root.entries.get("results");
  if (!results || results.kind !== "array")
    throw new InvalidReportError("JSON report results must be an array.");
  if (!results.items.length)
    throw new InvalidReportError("JSON report has no measurement rows.");
  return results.items.map((item, index) => {
    if (item.kind !== "object")
      throw new InvalidReportError("JSON report rows must be objects.");
    for (const key of item.entries.keys())
      if (!REPORT_FIELD_SET.has(key))
        throw new InvalidReportError("Unsupported JSON report row field.");
    const fields = new Map<string, FieldCell>();
    for (const field of REPORT_FIELDS) {
      const cell = jsonCell(
        item.entries.get(field),
        `/results/${index}/${escapePointerPart(field)}`,
      );
      if (cell) fields.set(field, cell);
    }
    for (const field of REQUIRED_REPORT_FIELDS)
      if (!fields.has(field))
        throw new InvalidReportError(
          "JSON report row is missing a required field.",
        );
    return {
      fields,
      pointer: `/results/${index}`,
      excerpt: text.slice(item.start, item.end),
    };
  });
}

function parseCsvRecords(input: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let index = 0;
  let row = 1;
  while (index < input.length) {
    const start = index;
    const cells: CsvCell[] = [];
    while (true) {
      const cellStart = index;
      let value = "";
      if (input[index] === '"') {
        index++;
        let closed = false;
        while (index < input.length) {
          if (input[index] === '"') {
            if (input[index + 1] === '"') {
              value += '"';
              index += 2;
            } else {
              index++;
              closed = true;
              break;
            }
          } else value += input[index++];
          if (value.length > MAX_CELL_CHARACTERS)
            throw new ReportLimitError("CSV field exceeds the parser limit.");
        }
        if (!closed) throw new InvalidReportError("Unclosed quoted CSV field.");
        if (index < input.length && ![",", "\r", "\n"].includes(input[index]))
          throw new InvalidReportError(
            "Unexpected content after quoted CSV field.",
          );
      } else {
        while (
          index < input.length &&
          ![",", "\r", "\n"].includes(input[index])
        ) {
          if (input[index] === '"')
            throw new InvalidReportError("Quote in an unquoted CSV field.");
          value += input[index++];
          if (value.length > MAX_CELL_CHARACTERS)
            throw new ReportLimitError("CSV field exceeds the parser limit.");
        }
      }
      cells.push({
        value,
        raw: input.slice(cellStart, index),
        start: cellStart,
        end: index,
      });
      if (cells.length > MAX_REPORT_COLUMNS)
        throw new ReportLimitError("CSV report contains too many columns.");
      if (index >= input.length) break;
      if (input[index] === ",") {
        index++;
        continue;
      }
      if (input[index] === "\r" && input[index + 1] === "\n") index += 2;
      else index++;
      break;
    }
    records.push({ cells, row, start, end: index });
    if (records.length > MAX_REPORT_ROWS + 1)
      throw new ReportLimitError("CSV report contains too many rows.");
    row++;
  }
  return records;
}

function parseCsvRows(source: string): ReportRow[] {
  const text = source.startsWith(CSV_PREFIX) ? source.slice(1) : source;
  const records = parseCsvRecords(text);
  const header = records[0];
  if (!header) throw new InvalidReportError("CSV report has no header row.");
  const headers = header.cells.map(({ value }) => value);
  if (
    new Set(headers).size !== headers.length ||
    headers.some((value) => !value || value.length > 128)
  ) {
    throw new InvalidReportError(
      "CSV report has missing or duplicate headers.",
    );
  }
  if (headers.length > MAX_REPORT_COLUMNS)
    throw new ReportLimitError("CSV report contains too many columns.");
  for (const field of headers)
    if (!REPORT_FIELD_SET.has(field) && field !== "schemaVersion")
      throw new InvalidReportError("Unsupported CSV report column.");
  for (const field of [...REQUIRED_REPORT_FIELDS, "schemaVersion"])
    if (!headers.includes(field))
      throw new InvalidReportError("CSV report is missing a required column.");
  const results: ReportRow[] = [];
  for (const record of records.slice(1)) {
    if (record.cells.length !== headers.length)
      throw new InvalidReportError(
        "CSV report row has the wrong number of columns.",
      );
    const fields = new Map<string, FieldCell>();
    for (let index = 0; index < headers.length; index++) {
      const name = headers[index];
      const cell = record.cells[index];
      if (name === "schemaVersion") {
        if (cell.value !== String(REPORT_SCHEMA_VERSION))
          throw new InvalidReportError(
            "Unsupported CSV report schema version.",
          );
        continue;
      }
      fields.set(name, {
        value: cell.value,
        raw: cell.raw,
        pointer: `csv:row/${record.row}/column/${escapePointerPart(name)}`,
      });
    }
    results.push({
      fields,
      pointer: `csv:row/${record.row}`,
      excerpt: text.slice(record.start, record.end).replace(/(?:\r?\n)+$/, ""),
    });
  }
  if (!results.length)
    throw new InvalidReportError("CSV report has no measurement rows.");
  return results;
}

function field(row: ReportRow, name: string) {
  return row.fields.get(name);
}
function textField(row: ReportRow, name: string) {
  const value = field(row, name)?.value.trim() || undefined;
  if (value && value.length > 500) {
    throw new ReportLimitError(
      "Report context field exceeds the safe length limit.",
    );
  }
  return value;
}

function valueNumber(cell: FieldCell) {
  const raw = cell.value.trim();
  if (CSV_FORMULA_PATTERN.test(raw) || !NUMBER_PATTERN.test(raw))
    throw new InvalidReportError("Report value is not a plain finite number.");
  const value = Number(raw);
  if (!Number.isFinite(value))
    throw new InvalidReportError("Report value is not finite.");
  return value;
}

function reportKind(value: string | undefined): string | undefined {
  return value === "benchmark" || value === "evaluation" || value === "coverage"
    ? value
    : undefined;
}

function sourcePointer(input: {
  row: ReportRow;
  source: ReportSourceContext;
}): EvidenceItem {
  const pointers = [...input.row.fields.values()].map(({ pointer }) => pointer);
  const excerpt = input.row.excerpt;
  const evidenceId = `report-${hash(`${input.source.fileId}\n${input.row.pointer}\n${excerpt}`).slice(0, 32)}`;
  return {
    id: evidenceId,
    snapshotId: input.source.snapshotId,
    commitSha: input.source.commitSha,
    path: input.source.path,
    blobSha: input.source.blobSha,
    pointer: { kind: "report-fields", fields: pointers },
    excerpt,
    excerptSha256: hash(excerpt),
    category: "report",
    classification: "observed",
  };
}

function answerHash(answer: Omit<MeasurementAnswer, "answerHash">) {
  return hash(JSON.stringify(answer));
}

function validateSource(
  context: ExecutionContext,
): ReportSourceContext | undefined {
  const source = (context as ReportExecutionContext).reportSource;
  if (!source) return undefined;
  if (
    !isSafeId(source.fileId) ||
    !isSafeId(source.snapshotId) ||
    !isSha(source.commitSha) ||
    !isSha(source.blobSha) ||
    !safePath(source.path)
  )
    return undefined;
  return source;
}

function parseWithDefinitions(
  input: { definitionId: string; source: string; context: ExecutionContext },
  dependencies: ReportParserDependencies,
): ReturnType<ReportParserPort["parseMeasurementReport"]> {
  const definition = dependencies.definitions.find(
    ({ id }) => id === input.definitionId,
  );
  if (!definition) {
    return ok({
      candidates: [],
      sourcePointers: [],
      unsupported: [
        "No trusted metric definition is registered for this report.",
      ],
    });
  }
  if (input.context.signal.aborted)
    return err(domainError("cancelled", "Report parsing was cancelled."));
  const deadline = Date.parse(input.context.deadline);
  if (!Number.isFinite(deadline) || input.context.now().getTime() >= deadline) {
    return err(
      domainError("limit-exceeded", "The report parsing deadline has expired."),
    );
  }
  if (typeof input.source !== "string" || input.source.length === 0) {
    return err(
      domainError(
        "invalid-evidence",
        "The selected report is empty or invalid.",
      ),
    );
  }
  const sourceMetadata = validateSource(input.context);
  if (!sourceMetadata) {
    return err(
      domainError(
        "invalid-evidence",
        "Selected report provenance is missing or invalid.",
      ),
    );
  }
  const bytes = byteLength(input.source);
  const lines = physicalLineCount(input.source);
  if (bytes > MAX_REPORT_BYTES || lines > MAX_REPORT_LINES) {
    return err(
      domainError(
        "limit-exceeded",
        "The selected report exceeds the 64 KiB or 200 line parser limit.",
      ),
    );
  }
  const algorithm = sourceMetadata.blobSha.length === 64 ? "sha256" : "sha1";
  if (
    gitBlobHash(input.source, algorithm) !==
    sourceMetadata.blobSha.toLowerCase()
  ) {
    return err(
      domainError(
        "invalid-evidence",
        "The selected report does not match its pinned blob hash.",
      ),
    );
  }
  const budget = input.context.budget.checkSelection({ files: 1, lines });
  if (!budget.ok || !budget.value.allowed) {
    return err(
      domainError(
        "limit-exceeded",
        budget.ok
          ? (budget.value.reason ?? "The shared evidence budget is exhausted.")
          : budget.error.message,
      ),
    );
  }

  try {
    const extension = sourceMetadata.path.split(".").at(-1)?.toLowerCase();
    if (extension !== "json" && extension !== "csv") {
      return ok({
        candidates: [],
        sourcePointers: [],
        unsupported: [
          "Only selected .json and .csv measurement reports are supported.",
        ],
      });
    }
    const rows =
      extension === "json"
        ? parseJsonRows(input.source)
        : parseCsvRows(input.source);
    const candidates: MeasurementAnswer[] = [];
    const sourcePointers: EvidenceItem[] = [];
    const unsupported: string[] = [];
    let needsContext: string[] | undefined;

    for (const row of rows) {
      if (row.excerpt.length > 20_000)
        throw new ReportLimitError(
          "Report row exceeds the evidence excerpt limit.",
        );
      const evidence = sourcePointer({ row, source: sourceMetadata });
      sourcePointers.push(evidence);
      if (textField(row, "metricId") !== definition.id) {
        unsupported.push(
          `${row.pointer}: metricId does not match the selected definition.`,
        );
        continue;
      }
      const kind = reportKind(textField(row, "reportKind"));
      if (!kind) {
        unsupported.push(
          `${row.pointer}: reportKind must be benchmark, evaluation, or coverage.`,
        );
        continue;
      }
      const rawUnit = textField(row, "unit");
      const acceptedUnits = new Set([
        definition.unit,
        ...(dependencies.acceptedUnits?.[definition.id] ?? []),
      ]);
      if (definition.unit === "same-dimension-as-target") {
        const targetUnit = textField(row, "targetUnit");
        if (!targetUnit || rawUnit !== targetUnit) {
          unsupported.push(
            `${row.pointer}: regression units must match the recorded targetUnit.`,
          );
          continue;
        }
      } else if (!rawUnit || !acceptedUnits.has(rawUnit)) {
        unsupported.push(
          `${row.pointer}: report unit does not match the metric definition.`,
        );
        continue;
      }
      if (textField(row, "statistic") !== definition.statistic) {
        unsupported.push(
          `${row.pointer}: report statistic does not match the metric definition.`,
        );
        continue;
      }
      const revision = textField(row, "revision");
      if (
        !revision ||
        !isSha(revision) ||
        revision.toLowerCase() !== sourceMetadata.commitSha.toLowerCase()
      ) {
        needsContext = [
          `${row.pointer}: report revision does not match the pinned repository snapshot.`,
        ];
        break;
      }
      const protocol = textField(row, "protocol");
      if (
        sourceMetadata.expectedProtocol &&
        protocol !== sourceMetadata.expectedProtocol
      ) {
        needsContext = [
          `${row.pointer}: report protocol does not match the expected protocol.`,
        ];
        break;
      }
      const contextFields: Record<string, string> = {
        capabilityId: definition.capability,
        sourceDescription: `Pinned report ${sourceMetadata.path.slice(0, 200)}@${sourceMetadata.commitSha} (${row.pointer.slice(0, 150)})`,
      };
      for (const name of REPORT_FIELDS) {
        const value = textField(row, name);
        if (value)
          contextFields[name === "split" ? "evaluationSplit" : name] = value;
      }
      const requiredContext = new Set(definition.requiredContext);
      requiredContext.add("revision");
      if (kind === "benchmark") {
        requiredContext.add("workload");
        requiredContext.add("runId");
      } else if (kind === "evaluation") {
        requiredContext.add("dataset");
        requiredContext.add("evaluationSplit");
      } else {
        requiredContext.add("denominator");
        requiredContext.add("toolName");
        requiredContext.add("scope");
      }
      const missing = [...requiredContext].filter(
        (name) => !contextFields[name],
      );
      if (missing.length) {
        needsContext = [
          `${row.pointer}: report needs ${missing.join(", ")} context.`,
        ];
        break;
      }
      const valueCell = field(row, "value");
      if (!valueCell)
        throw new InvalidReportError("Report measurement value is missing.");
      const value = valueNumber(valueCell);
      if (
        value < definition.allowedRange.min ||
        value > definition.allowedRange.max
      ) {
        unsupported.push(
          `${row.pointer}: value is outside the metric definition range.`,
        );
        continue;
      }
      if (kind === "coverage") {
        const denominator = textField(row, "denominator");
        if (!denominator || !/^[1-9]\d*$/.test(denominator)) {
          throw new InvalidReportError(
            "Coverage report denominator must be a positive integer.",
          );
        }
      }
      const answerWithoutHash: Omit<MeasurementAnswer, "answerHash"> = {
        questionId: `report-${hash(`${input.context.runId}\n${definition.id}\n${row.pointer}`).slice(0, 24)}`,
        version: 1,
        mode: "report",
        originalValues: [value],
        originalUnits: [rawUnit ?? ""],
        definitionId: definition.id,
        statistic: definition.statistic,
        context: contextFields,
        sourceEvidenceIds: [evidence.id],
        attestation: "measured",
      };
      candidates.push({
        ...answerWithoutHash,
        answerHash: answerHash(answerWithoutHash),
      });
      if (candidates.length > GITHUB_IMPORT_POLICY.metricCandidates) {
        throw new ReportLimitError(
          "Report contains more candidates than the metric review limit.",
        );
      }
    }
    if (needsContext) return err(domainError("needs-context", needsContext[0]));
    return ok({ candidates, sourcePointers, unsupported });
  } catch (error) {
    if (error instanceof ReportLimitError)
      return err(domainError("limit-exceeded", error.message));
    if (error instanceof InvalidReportError)
      return err(domainError("invalid-evidence", error.message));
    return err(
      domainError(
        "invalid-evidence",
        "The selected report could not be parsed safely.",
      ),
    );
  }
}

/** Parses selected JSON/CSV report text only; this parser never performs IO or executes project content. */
export function createReportParser(
  dependencies: ReportParserDependencies,
): ReportParserPort {
  const definitions = new Map<string, MeasurementDefinition>();
  for (const definition of dependencies.definitions) {
    if (definitions.has(definition.id))
      throw new Error(`Duplicate report metric definition: ${definition.id}`);
    definitions.set(definition.id, definition);
  }
  const stableDependencies = {
    ...dependencies,
    definitions: [...definitions.values()],
  };
  return {
    parseMeasurementReport(input) {
      return parseWithDefinitions(input, stableDependencies);
    },
  };
}

export const measurementReportLimits = Object.freeze({
  maxBytes: MAX_REPORT_BYTES,
  maxLines: MAX_REPORT_LINES,
  maxRows: MAX_REPORT_ROWS,
  maxColumns: MAX_REPORT_COLUMNS,
});
