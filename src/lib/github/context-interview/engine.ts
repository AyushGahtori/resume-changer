import { z } from "zod";
import {
  CatalogMigrationSchema,
  InterviewAnswerSchema,
  InterviewStateSchema,
  MAX_INTERVIEW_QUESTIONS,
  OwnershipSchema,
  PROJECT_CONTEXT_VERSION,
  ProjectContextSchema,
  ProjectKindSchema,
  QuestionCatalogSchema,
  RepositorySuggestionSchema,
  type CatalogMigration,
  type Condition,
  type ContextFact,
  type FactField,
  type InformationTarget,
  type InterviewAnswer,
  type InterviewState,
  type MigrationNotice,
  type ProjectContext,
  type QuestionCatalog,
  type QuestionNode,
  type RepositorySuggestion,
} from "./types";

export type CatalogIssue = {
  code: string;
  path: string;
  message: string;
};

export type CatalogValidation =
  | { success: true; catalog: QuestionCatalog; issues: [] }
  | { success: false; issues: CatalogIssue[] };

export class InterviewCatalogError extends Error {
  readonly issues: CatalogIssue[];

  constructor(issues: CatalogIssue[]) {
    super("The question catalog is invalid.");
    this.name = "InterviewCatalogError";
    this.issues = issues;
  }
}

export class InterviewStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InterviewStateError";
  }
}

const stableCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const targetField: Record<InformationTarget, FactField> = {
  "primary-kind": "primaryKind",
  "project-purpose": "projectPurpose",
  "secondary-tags": "secondaryTags",
  ownership: "ownership",
  collaboration: "collaboration",
  "intended-users": "intendedUsers",
  "confirmed-capabilities": "confirmedCapabilities",
  "contributed-areas": "contributedAreas",
  "contribution-details": "contributionDetails",
  "outcome-evidence": "outcomeEvidence",
  limitations: "limitations",
};

function addIssue(
  issues: CatalogIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}

function hasContradictoryConditions(
  conditions: Condition[],
  nodes: Map<string, QuestionNode>,
): string | null {
  const selectedByNode = new Map<string, string[][]>();
  const skippedNodes = new Set<string>();
  const hintStatuses = new Map<string, string>();

  for (const condition of conditions) {
    if (condition.op === "selected-any") {
      const selections = selectedByNode.get(condition.nodeId) ?? [];
      selections.push(condition.optionIds);
      selectedByNode.set(condition.nodeId, selections);
    } else if (condition.op === "skipped") {
      skippedNodes.add(condition.nodeId);
    } else {
      const previous = hintStatuses.get(condition.hintId);
      if (previous && previous !== condition.status) {
        return "One edge cannot require two different dispositions for the same repository suggestion.";
      }
      hintStatuses.set(condition.hintId, condition.status);
    }
  }

  for (const nodeId of skippedNodes) {
    if (selectedByNode.has(nodeId)) {
      return "A skipped answer cannot also have a selected option.";
    }
  }

  for (const [nodeId, selections] of selectedByNode) {
    const node = nodes.get(nodeId);
    if (!node || node.selectionMode !== "single") continue;
    for (let first = 0; first < selections.length; first += 1) {
      for (let second = first + 1; second < selections.length; second += 1) {
        const overlap = selections[first].some((optionId) =>
          selections[second].includes(optionId),
        );
        if (!overlap) {
          return "A single-select answer cannot satisfy disjoint selected-option conditions.";
        }
      }
    }
  }

  return null;
}

export function validateQuestionCatalog(input: unknown): CatalogValidation {
  const parsed = QuestionCatalogSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        code: issue.code,
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
  }

  const catalog = parsed.data;
  const issues: CatalogIssue[] = [];
  const nodes = new Map<string, QuestionNode>();
  const incoming = new Map<string, string[]>();

  catalog.nodes.forEach((node, index) => {
    if (nodes.has(node.id)) {
      addIssue(
        issues,
        "duplicate-node",
        "nodes." + index + ".id",
        "Question IDs must be unique.",
      );
    } else {
      nodes.set(node.id, node);
    }
    incoming.set(node.id, []);

    const targetIds = new Set<string>();
    node.edges.forEach((candidate, edgeIndex) => {
      if (targetIds.has(candidate.to)) {
        addIssue(
          issues,
          "duplicate-edge",
          "nodes." + index + ".edges." + edgeIndex + ".to",
          "A question can list a target only once.",
        );
      }
      targetIds.add(candidate.to);
    });
  });

  const root = nodes.get(catalog.rootId);
  if (!root) {
    addIssue(
      issues,
      "missing-root",
      "rootId",
      "The root question does not exist.",
    );
  } else if (root.phase !== "setup") {
    addIssue(
      issues,
      "invalid-root",
      "rootId",
      "The root must be a setup question.",
    );
  }

  const adjacency = new Map<string, string[]>();
  for (const node of catalog.nodes) {
    const targets: string[] = [];
    for (let edgeIndex = 0; edgeIndex < node.edges.length; edgeIndex += 1) {
      const candidate = node.edges[edgeIndex];
      const target = nodes.get(candidate.to);
      const edgePath = "nodes." + node.id + ".edges." + edgeIndex;
      if (!target) {
        addIssue(
          issues,
          "unknown-edge-target",
          edgePath + ".to",
          "The candidate question does not exist.",
        );
      } else {
        targets.push(target.id);
        incoming.get(target.id)?.push(node.id);
      }

      const conflict = hasContradictoryConditions(candidate.when, nodes);
      if (conflict) {
        addIssue(
          issues,
          "conflicting-conditions",
          edgePath + ".when",
          conflict,
        );
      }

      for (
        let conditionIndex = 0;
        conditionIndex < candidate.when.length;
        conditionIndex += 1
      ) {
        const condition = candidate.when[conditionIndex];
        const conditionPath = edgePath + ".when." + conditionIndex;
        if (condition.op === "hint-status") continue;
        const referencedNode = nodes.get(condition.nodeId);
        if (!referencedNode) {
          addIssue(
            issues,
            "unknown-condition-question",
            conditionPath + ".nodeId",
            "The condition references an unknown question.",
          );
          continue;
        }
        if (condition.op === "selected-any") {
          const optionIds = new Set(
            referencedNode.options.map((option) => option.id),
          );
          condition.optionIds.forEach((optionId, optionIndex) => {
            if (!optionIds.has(optionId)) {
              addIssue(
                issues,
                "unknown-condition-option",
                conditionPath + ".optionIds." + optionIndex,
                "The condition references an unknown answer option.",
              );
            }
          });
        }
      }
    }
    adjacency.set(node.id, targets);
  }

  if (incoming.get(catalog.rootId)?.length) {
    addIssue(
      issues,
      "root-has-parent",
      "rootId",
      "The root question cannot have an incoming edge.",
    );
  }
  if (new Set(catalog.wrapUpNodeIds).size !== catalog.wrapUpNodeIds.length) {
    addIssue(
      issues,
      "duplicate-wrap-up",
      "wrapUpNodeIds",
      "Wrap-up questions must be distinct.",
    );
  }
  catalog.wrapUpNodeIds.forEach((nodeId, index) => {
    if (nodes.get(nodeId)?.phase !== "wrap-up") {
      addIssue(
        issues,
        "invalid-wrap-up",
        "wrapUpNodeIds." + index,
        "Each reserved wrap-up ID must identify a wrap-up question.",
      );
    }
  });

  const ancestors = (nodeId: string): Set<string> => {
    const found = new Set<string>();
    const pending = [...(incoming.get(nodeId) ?? [])];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current || found.has(current)) continue;
      found.add(current);
      pending.push(...(incoming.get(current) ?? []));
    }
    return found;
  };

  for (const node of catalog.nodes) {
    const validConditionSources = ancestors(node.id);
    validConditionSources.add(node.id);
    node.edges.forEach((candidate, edgeIndex) => {
      candidate.when.forEach((condition, conditionIndex) => {
        if (
          condition.op !== "hint-status" &&
          !validConditionSources.has(condition.nodeId)
        ) {
          addIssue(
            issues,
            "future-condition-reference",
            "nodes." +
              node.id +
              ".edges." +
              edgeIndex +
              ".when." +
              conditionIndex,
            "An edge can only inspect its own question or an earlier question.",
          );
        }
      });
    });
  }

  const colors = new Map<string, "gray" | "black">();
  const cyclicNodes = new Set<string>();
  const visitForCycle = (nodeId: string, stack: string[]) => {
    const color = colors.get(nodeId);
    if (color === "gray") {
      cyclicNodes.add(nodeId);
      stack.slice(stack.indexOf(nodeId)).forEach((id) => cyclicNodes.add(id));
      return;
    }
    if (color === "black") return;
    colors.set(nodeId, "gray");
    for (const next of adjacency.get(nodeId) ?? []) {
      visitForCycle(next, [...stack, nodeId]);
    }
    colors.set(nodeId, "black");
  };
  for (const node of catalog.nodes) visitForCycle(node.id, []);
  for (const nodeId of cyclicNodes) {
    addIssue(
      issues,
      "cycle",
      "nodes." + nodeId + ".edges",
      "The question graph must be acyclic.",
    );
  }

  const reachable = new Set<string>();
  const pending = root ? [root.id] : [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    pending.push(...(adjacency.get(current) ?? []));
  }
  for (const node of catalog.nodes) {
    if (!reachable.has(node.id)) {
      addIssue(
        issues,
        "unreachable-question",
        "nodes." + node.id,
        "Every question must be reachable from the root.",
      );
    }
  }

  if (issues.length > 0) return { success: false, issues };
  return { success: true, catalog, issues: [] };
}

function requireCatalog(input: unknown): QuestionCatalog {
  const result = validateQuestionCatalog(input);
  if (!result.success) throw new InterviewCatalogError(result.issues);
  return result.catalog;
}

function requireState(
  catalog: QuestionCatalog,
  input: unknown,
): InterviewState {
  const parsed = InterviewStateSchema.safeParse(input);
  if (!parsed.success) {
    throw new InterviewStateError(
      "Invalid interview state: " +
        parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }
  const state = parsed.data;
  if (state.catalogVersion !== catalog.version) {
    throw new InterviewStateError(
      "The interview state uses a different catalog version.",
    );
  }
  const nodes = new Map(catalog.nodes.map((node) => [node.id, node]));
  const presented = new Set(state.presentedNodeIds);
  const answers = new Set(state.answers.map((answer) => answer.nodeId));
  if (state.currentNodeId && !presented.has(state.currentNodeId)) {
    throw new InterviewStateError(
      "The current question must have been presented.",
    );
  }
  for (const answer of state.answers) {
    const node = nodes.get(answer.nodeId);
    if (!node || !presented.has(answer.nodeId)) {
      throw new InterviewStateError(
        "An answer references a question that was not presented.",
      );
    }
    if (answer.catalogVersion !== catalog.version) {
      throw new InterviewStateError(
        "An answer uses a different catalog version.",
      );
    }
    validateAnswerForNode(answer, node);
  }
  for (const nodeId of state.presentedNodeIds) {
    if (!nodes.has(nodeId)) {
      throw new InterviewStateError(
        "The presented question does not exist in this catalog.",
      );
    }
    if (nodeId !== state.currentNodeId && !answers.has(nodeId)) {
      throw new InterviewStateError(
        "A presented question must have an answer unless it is current.",
      );
    }
  }
  return state;
}

function validateAnswerForNode(
  input: unknown,
  node: QuestionNode,
): InterviewAnswer {
  const parsed = InterviewAnswerSchema.safeParse(input);
  if (!parsed.success) {
    throw new InterviewStateError(
      "Invalid answer: " +
        parsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }
  const answer = parsed.data;
  const optionIds = new Set(node.options.map((option) => option.id));
  if (answer.optionIds.some((optionId) => !optionIds.has(optionId))) {
    throw new InterviewStateError("An answer contains an unknown option ID.");
  }
  if (node.selectionMode === "single" && answer.optionIds.length > 1) {
    throw new InterviewStateError("This question accepts one selected option.");
  }
  if (
    answer.customAnswer !== undefined &&
    !answer.optionIds.includes("custom") &&
    node.id !== "project.purpose"
  ) {
    throw new InterviewStateError(
      "Custom text requires the custom answer option.",
    );
  }
  return answer;
}

export type InterviewCompletion = {
  reason: "question-limit" | "no-relevant-questions";
  presentedQuestionCount: number;
  answeredQuestionCount: number;
  skippedQuestionCount: number;
  missingInformationTargets: InformationTarget[];
};

export type NextQuestionResult =
  | {
      status: "question";
      question: QuestionNode;
      state: InterviewState;
    }
  | {
      status: "complete";
      completion: InterviewCompletion;
      state: InterviewState;
    };

export type CreateInterviewStateOptions = {
  repositorySuggestions?: RepositorySuggestion[];
  notes?: string;
};

export function createInterviewState(
  options: CreateInterviewStateOptions = {},
): InterviewState {
  return InterviewStateSchema.parse({
    catalogVersion: PROJECT_CONTEXT_VERSION,
    answers: [],
    presentedNodeIds: [],
    currentNodeId: null,
    repositorySuggestions: options.repositorySuggestions ?? [],
    notes: options.notes ?? "",
  });
}

function answerMap(state: InterviewState): Map<string, InterviewAnswer> {
  return new Map(state.answers.map((answer) => [answer.nodeId, answer]));
}

function hintMap(state: InterviewState): Map<string, RepositorySuggestion> {
  return new Map(
    state.repositorySuggestions.map((suggestion) => [
      suggestion.id,
      suggestion,
    ]),
  );
}

function evaluateCondition(
  condition: Condition,
  answers: Map<string, InterviewAnswer>,
  hints: Map<string, RepositorySuggestion>,
): "true" | "false" | "unknown" {
  if (condition.op === "selected-any") {
    const answer = answers.get(condition.nodeId);
    if (!answer) return "unknown";
    if (answer.skipped) return "false";
    return answer.optionIds.some((optionId) =>
      condition.optionIds.includes(optionId),
    )
      ? "true"
      : "false";
  }
  if (condition.op === "skipped") {
    const answer = answers.get(condition.nodeId);
    if (!answer) return "unknown";
    return answer.skipped ? "true" : "false";
  }
  const hint = hints.get(condition.hintId);
  if (!hint || hint.disposition === "suggested") return "unknown";
  return hint.disposition === condition.status ? "true" : "false";
}

function conditionsAreMet(
  conditions: Condition[],
  answers: Map<string, InterviewAnswer>,
  hints: Map<string, RepositorySuggestion>,
): boolean {
  return conditions.every(
    (condition) => evaluateCondition(condition, answers, hints) === "true",
  );
}

function conditionsMayHold(
  conditions: Condition[],
  answers: Map<string, InterviewAnswer>,
  hints: Map<string, RepositorySuggestion>,
): boolean {
  return conditions.every(
    (condition) => evaluateCondition(condition, answers, hints) !== "false",
  );
}

function reachableForCurrentAnswers(
  catalog: QuestionCatalog,
  state: InterviewState,
  allowUnknown: boolean,
): Set<string> {
  const answers = answerMap(state);
  const hints = hintMap(state);
  const nodes = new Map(catalog.nodes.map((node) => [node.id, node]));
  const reachable = new Set<string>();
  const pending = [catalog.rootId];

  while (pending.length > 0) {
    const currentId = pending.pop();
    if (!currentId || reachable.has(currentId)) continue;
    reachable.add(currentId);
    const current = nodes.get(currentId);
    if (!current) continue;
    for (const candidate of current.edges) {
      const conditionsPass = allowUnknown
        ? conditionsMayHold(candidate.when, answers, hints)
        : conditionsAreMet(candidate.when, answers, hints);
      if (conditionsPass) pending.push(candidate.to);
    }
  }
  return reachable;
}

function topologicalHistory(
  catalog: QuestionCatalog,
  state: InterviewState,
  nodeIds: string[],
): string[] {
  const included = new Set(nodeIds);
  const originalIndex = new Map(nodeIds.map((id, index) => [id, index]));
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map(nodeIds.map((id) => [id, new Set<string>()]));
  const answers = answerMap(state);
  const hints = hintMap(state);
  const nodes = new Map(catalog.nodes.map((node) => [node.id, node]));

  for (const fromId of nodeIds) {
    const node = nodes.get(fromId);
    if (!node) continue;
    for (const candidate of node.edges) {
      if (
        !included.has(candidate.to) ||
        !conditionsMayHold(candidate.when, answers, hints)
      ) {
        continue;
      }
      const edges = outgoing.get(fromId);
      if (!edges || edges.has(candidate.to)) continue;
      edges.add(candidate.to);
      indegree.set(candidate.to, (indegree.get(candidate.to) ?? 0) + 1);
    }
  }

  const ready = nodeIds.filter((id) => indegree.get(id) === 0);
  const ordered: string[] = [];
  const sortReady = () =>
    ready.sort((left, right) => {
      const leftIndex = originalIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = originalIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex || stableCompare(left, right);
    });

  while (ready.length > 0) {
    sortReady();
    const current = ready.shift();
    if (!current) break;
    ordered.push(current);
    for (const next of outgoing.get(current) ?? []) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) ready.push(next);
    }
  }

  return ordered.length === nodeIds.length ? ordered : [...nodeIds];
}

export type PruneResult = {
  state: InterviewState;
  removedNodeIds: string[];
};

export function pruneInvalidAnswers(
  catalogInput: QuestionCatalog | unknown,
  stateInput: InterviewState | unknown,
): PruneResult {
  const catalog = requireCatalog(catalogInput);
  const state = requireState(catalog, stateInput);
  const potentiallyReachable = reachableForCurrentAnswers(catalog, state, true);
  const retainedAnswers = state.answers.filter((answer) =>
    potentiallyReachable.has(answer.nodeId),
  );
  const retainedIds = new Set(retainedAnswers.map((answer) => answer.nodeId));
  const removedNodeIds = state.answers
    .filter((answer) => !retainedIds.has(answer.nodeId))
    .map((answer) => answer.nodeId);
  const historyCandidates = state.presentedNodeIds.filter((nodeId) =>
    potentiallyReachable.has(nodeId),
  );
  for (const answer of retainedAnswers) {
    if (!historyCandidates.includes(answer.nodeId))
      historyCandidates.push(answer.nodeId);
  }
  const partiallyPruned = {
    ...state,
    answers: retainedAnswers,
    presentedNodeIds: historyCandidates,
    currentNodeId:
      state.currentNodeId && potentiallyReachable.has(state.currentNodeId)
        ? state.currentNodeId
        : null,
  };
  const orderedIds = topologicalHistory(
    catalog,
    partiallyPruned,
    historyCandidates,
  );
  return {
    state: InterviewStateSchema.parse({
      ...partiallyPruned,
      presentedNodeIds: orderedIds,
    }),
    removedNodeIds,
  };
}

function targetIsPresent(
  context: ProjectContext,
  target: InformationTarget,
): boolean {
  const field = targetField[target];
  const value = context[field];
  if (Array.isArray(value)) return value.length > 0;
  return value !== null;
}

function missingTargets(
  context: ProjectContext,
  node: QuestionNode,
): InformationTarget[] {
  return node.informationTargets.filter(
    (target) => !targetIsPresent(context, target),
  );
}

function branchPreference(
  catalog: QuestionCatalog,
  node: QuestionNode,
  state: InterviewState,
): number {
  if (node.phase !== "branch" || !node.branchAreaOptionId) return 0;
  const areas = answerMap(state).get("project.areas");
  if (!areas || areas.skipped) return 0;
  if (!areas.optionIds.includes(node.branchAreaOptionId)) return 0;
  const areaNode = catalog.nodes.find(
    (candidate) => candidate.id === "project.areas",
  );
  const optionIndex =
    areaNode?.options.findIndex(
      (option) => option.id === node.branchAreaOptionId,
    ) ?? -1;
  if (optionIndex < 0) return 0;
  return Math.max(1, (areaNode?.options.length ?? 5) - optionIndex);
}

function buildCompletion(
  catalog: QuestionCatalog,
  state: InterviewState,
  reason: InterviewCompletion["reason"],
): InterviewCompletion {
  const context = buildProjectContext(catalog, state);
  const allTargets = new Set<InformationTarget>();
  for (const node of catalog.nodes) {
    for (const target of node.informationTargets) allTargets.add(target);
  }
  const missingInformationTargets = [...allTargets]
    .filter((target) => !targetIsPresent(context, target))
    .sort(stableCompare);
  return {
    reason,
    presentedQuestionCount: state.presentedNodeIds.length,
    answeredQuestionCount: state.answers.filter((answer) => !answer.skipped)
      .length,
    skippedQuestionCount: state.answers.filter((answer) => answer.skipped)
      .length,
    missingInformationTargets,
  };
}

export function nextQuestion(
  catalogInput: QuestionCatalog | unknown,
  stateInput: InterviewState | unknown,
): NextQuestionResult {
  const catalog = requireCatalog(catalogInput);
  const state = requireState(catalog, stateInput);
  const nodeById = new Map(catalog.nodes.map((node) => [node.id, node]));

  if (state.currentNodeId) {
    const current = nodeById.get(state.currentNodeId);
    if (!current)
      throw new InterviewStateError("The current question is missing.");
    return { status: "question", question: current, state };
  }

  if (state.presentedNodeIds.length >= catalog.maxQuestions) {
    return {
      status: "complete",
      completion: buildCompletion(catalog, state, "question-limit"),
      state,
    };
  }

  if (state.presentedNodeIds.length === 0 && state.answers.length === 0) {
    const rootQuestion = nodeById.get(catalog.rootId);
    if (!rootQuestion)
      throw new InterviewStateError("The root question is missing.");
    return {
      status: "question",
      question: rootQuestion,
      state: InterviewStateSchema.parse({
        ...state,
        presentedNodeIds: [rootQuestion.id],
        currentNodeId: rootQuestion.id,
      }),
    };
  }

  const answers = answerMap(state);
  const hints = hintMap(state);
  const presented = new Set(state.presentedNodeIds);
  const candidates = new Map<string, QuestionNode>();
  for (const sourceId of state.presentedNodeIds) {
    if (!answers.has(sourceId)) continue;
    const source = nodeById.get(sourceId);
    if (!source) continue;
    for (const candidate of source.edges) {
      if (!conditionsAreMet(candidate.when, answers, hints)) continue;
      if (presented.has(candidate.to) || answers.has(candidate.to)) continue;
      const target = nodeById.get(candidate.to);
      if (target) candidates.set(target.id, target);
    }
  }

  const unpresentedWrapUps = catalog.wrapUpNodeIds.filter(
    (nodeId) => !presented.has(nodeId),
  ).length;
  const remainingQuestionSlots = catalog.maxQuestions - presented.size;
  const remainingBranchSlots = Math.max(
    0,
    remainingQuestionSlots - unpresentedWrapUps,
  );
  const eligible = [...candidates.values()].filter(
    (node) => node.phase !== "branch" || remainingBranchSlots > 0,
  );

  if (eligible.length === 0) {
    return {
      status: "complete",
      completion: buildCompletion(catalog, state, "no-relevant-questions"),
      state,
    };
  }

  const context = buildProjectContext(catalog, state);
  eligible.sort((left, right) => {
    const priority = right.priority - left.priority;
    if (priority !== 0) return priority;
    const missing =
      missingTargets(context, right).length -
      missingTargets(context, left).length;
    if (missing !== 0) return missing;
    const relevance =
      branchPreference(catalog, right, state) -
      branchPreference(catalog, left, state);
    if (relevance !== 0) return relevance;
    return stableCompare(left.id, right.id);
  });

  const question = eligible[0];
  if (!question) {
    return {
      status: "complete",
      completion: buildCompletion(catalog, state, "no-relevant-questions"),
      state,
    };
  }
  const presentedNodeIds = topologicalHistory(catalog, state, [
    ...state.presentedNodeIds,
    question.id,
  ]);
  const nextState = InterviewStateSchema.parse({
    ...state,
    presentedNodeIds,
    currentNodeId: question.id,
  });
  return { status: "question", question, state: nextState };
}

export function applyAnswer(
  catalogInput: QuestionCatalog | unknown,
  stateInput: InterviewState | unknown,
  answerInput: unknown,
): InterviewState {
  const catalog = requireCatalog(catalogInput);
  const state = requireState(catalog, stateInput);
  const answerParsed = InterviewAnswerSchema.safeParse(answerInput);
  if (!answerParsed.success) {
    throw new InterviewStateError(
      "Invalid answer: " +
        answerParsed.error.issues.map((issue) => issue.message).join(" "),
    );
  }
  const answer = answerParsed.data;
  if (!state.currentNodeId || state.currentNodeId !== answer.nodeId) {
    throw new InterviewStateError("Answer the currently presented question.");
  }
  const node = catalog.nodes.find(
    (candidate) => candidate.id === answer.nodeId,
  );
  if (!node) throw new InterviewStateError("The question does not exist.");
  if (answer.catalogVersion !== catalog.version) {
    throw new InterviewStateError(
      "The answer uses a different catalog version.",
    );
  }
  validateAnswerForNode(answer, node);

  const answers = [
    ...state.answers.filter((existing) => existing.nodeId !== answer.nodeId),
    answer,
  ];
  const result = pruneInvalidAnswers(catalog, {
    ...state,
    answers,
    currentNodeId: null,
  });
  return result.state;
}

export function goBack(
  catalogInput: QuestionCatalog | unknown,
  stateInput: InterviewState | unknown,
): InterviewState {
  const catalog = requireCatalog(catalogInput);
  const state = requireState(catalog, stateInput);
  const historyIndex = state.currentNodeId
    ? state.presentedNodeIds.indexOf(state.currentNodeId)
    : state.presentedNodeIds.length;
  const previousId =
    historyIndex > 0 ? state.presentedNodeIds[historyIndex - 1] : undefined;
  if (!previousId) return state;
  // A history entry may be unanswered only while it is the current question.
  // Remove the question we are leaving when it has no answer, so revisiting an
  // earlier answer does not create an invalid state. Answered entries remain
  // available for review and branch pruning; the next unanswered question can
  // be discovered again when the user continues.
  const answeredIds = new Set(state.answers.map((answer) => answer.nodeId));
  return requireState(catalog, {
    ...state,
    presentedNodeIds: state.presentedNodeIds.filter(
      (nodeId) => nodeId === previousId || answeredIds.has(nodeId),
    ),
    currentNodeId: previousId,
  });
}

export function setExtraNotes(
  stateInput: InterviewState | unknown,
  notes: string,
): InterviewState {
  const parsed = InterviewStateSchema.safeParse(stateInput);
  if (!parsed.success) {
    throw new InterviewStateError(
      "Cannot update notes on invalid interview state.",
    );
  }
  return InterviewStateSchema.parse({ ...parsed.data, notes });
}

export function setRepositorySuggestionDisposition(
  catalogInput: QuestionCatalog | unknown,
  stateInput: InterviewState | unknown,
  hintId: string,
  disposition: "accepted" | "dismissed" | "suggested",
): InterviewState {
  const catalog = requireCatalog(catalogInput);
  const state = requireState(catalog, stateInput);
  const exists = state.repositorySuggestions.some((hint) => hint.id === hintId);
  if (!exists)
    throw new InterviewStateError("The repository suggestion does not exist.");
  const repositorySuggestions = state.repositorySuggestions.map((hint) =>
    hint.id === hintId ? { ...hint, disposition } : hint,
  );
  return pruneInvalidAnswers(catalog, {
    ...state,
    repositorySuggestions,
  }).state;
}

export function reviewContext(
  catalogInput: QuestionCatalog | unknown,
  stateInput: InterviewState | unknown,
): ProjectContext {
  const catalog = requireCatalog(catalogInput);
  const state = requireState(catalog, stateInput);
  const pruned = pruneInvalidAnswers(catalog, state).state;
  return buildProjectContext(catalog, pruned);
}

function buildProjectContext(
  catalog: QuestionCatalog,
  state: InterviewState,
): ProjectContext {
  const context = {
    version: catalog.version,
    primaryKind: null as ContextFact | null,
    projectPurpose: null as ContextFact | null,
    ownership: null as ContextFact | null,
    collaboration: null as ContextFact | null,
    secondaryTags: [] as ContextFact[],
    intendedUsers: [] as ContextFact[],
    confirmedCapabilities: [] as ContextFact[],
    contributedAreas: [] as ContextFact[],
    contributionDetails: [] as ContextFact[],
    outcomeEvidence: [] as ContextFact[],
    limitations: [] as ContextFact[],
    notes: state.notes
      ? { value: state.notes, provenance: "user-reported" as const }
      : null,
    answers: state.answers,
    answerHistory: state.presentedNodeIds,
    repositorySuggestions: state.repositorySuggestions,
  };

  const nodes = new Map(catalog.nodes.map((node) => [node.id, node]));
  const answers = [...state.answers].sort(
    (left, right) =>
      state.presentedNodeIds.indexOf(left.nodeId) -
      state.presentedNodeIds.indexOf(right.nodeId),
  );
  const addFact = (
    field: FactField,
    value: string,
    source: Omit<ContextFact, "value" | "provenance">,
    provenance: ContextFact["provenance"] = "user-reported",
  ) => {
    const factValue: ContextFact = { value, provenance, ...source };
    if (field === "primaryKind") {
      if (ProjectKindSchema.safeParse(value).success)
        context.primaryKind = factValue;
      return;
    }
    if (field === "ownership") {
      if (OwnershipSchema.safeParse(value).success)
        context.ownership = factValue;
      return;
    }
    if (field === "collaboration") {
      context.collaboration = factValue;
      return;
    }
    if (field === "projectPurpose") {
      context.projectPurpose = factValue;
      return;
    }
    const collection = context[field] as ContextFact[];
    const duplicate = collection.some(
      (existing) =>
        existing.value === value &&
        existing.questionId === source.questionId &&
        existing.optionId === source.optionId &&
        existing.repositoryHintId === source.repositoryHintId,
    );
    if (!duplicate) collection.push(factValue);
  };

  for (const answer of answers) {
    if (answer.skipped) continue;
    const node = nodes.get(answer.nodeId);
    if (!node) continue;
    for (const optionId of answer.optionIds) {
      const option = node.options.find(
        (candidate) => candidate.id === optionId,
      );
      if (!option) continue;
      for (const contribution of option.facts) {
        addFact(contribution.field, contribution.value, {
          questionId: node.id,
          optionId: option.id,
        });
      }
    }
    if (answer.customAnswer && node.customTarget) {
      addFact(node.customTarget, answer.customAnswer, { questionId: node.id });
    }
  }

  for (const hint of state.repositorySuggestions) {
    if (hint.disposition !== "accepted") continue;
    const source = { repositoryHintId: hint.id };
    if (hint.target === "project-kind") {
      if (
        !context.primaryKind &&
        ProjectKindSchema.safeParse(hint.value).success
      ) {
        addFact("primaryKind", hint.value, source, "user-confirmed");
      }
    } else if (hint.target === "capability") {
      addFact("confirmedCapabilities", hint.value, source, "user-confirmed");
    } else {
      addFact("secondaryTags", hint.value, source, "user-confirmed");
    }
  }

  return ProjectContextSchema.parse(context);
}

export function serializeProjectContext(
  input: ProjectContext | unknown,
): string {
  const context = ProjectContextSchema.parse(input);
  const canonicalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object") {
      const objectValue = value as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(objectValue)
          .sort()
          .map((key) => [key, canonicalize(objectValue[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(canonicalize(context));
}

export function getInterviewCompletion(
  catalogInput: QuestionCatalog | unknown,
  stateInput: InterviewState | unknown,
): InterviewCompletion | null {
  const result = nextQuestion(catalogInput, stateInput);
  return result.status === "complete" ? result.completion : null;
}

export function isInterviewComplete(
  catalogInput: QuestionCatalog | unknown,
  stateInput: InterviewState | unknown,
): boolean {
  return getInterviewCompletion(catalogInput, stateInput) !== null;
}

export type AnswerMigrationResult =
  | { success: true; answers: InterviewAnswer[]; notices: MigrationNotice[] }
  | {
      success: false;
      error:
        | "invalid-answers"
        | "mixed-catalog-versions"
        | "unsupported-catalog-version"
        | "invalid-migration"
        | "invalid-target-answer";
      message: string;
    };

export function migrateAnswers(
  catalogInput: QuestionCatalog | unknown,
  input: unknown,
  migrationInput?: CatalogMigration | unknown,
): AnswerMigrationResult {
  const catalog = requireCatalog(catalogInput);
  const parsedAnswers = z
    .array(InterviewAnswerSchema)
    .max(MAX_INTERVIEW_QUESTIONS)
    .safeParse(input);
  if (!parsedAnswers.success) {
    return {
      success: false,
      error: "invalid-answers",
      message: "The saved answer history is malformed.",
    };
  }
  const answers = parsedAnswers.data;
  const versions = new Set(answers.map((answer) => answer.catalogVersion));
  if (versions.size > 1) {
    return {
      success: false,
      error: "mixed-catalog-versions",
      message: "Answers from different catalog versions cannot be combined.",
    };
  }
  const sourceVersion = [...versions][0] ?? catalog.version;
  if (sourceVersion === catalog.version) {
    const targetNodes = new Map(catalog.nodes.map((node) => [node.id, node]));
    try {
      const normalized = answers.map((answer) => {
        const node = targetNodes.get(answer.nodeId);
        if (!node) throw new Error("Unknown question.");
        return validateAnswerForNode(answer, node);
      });
      if (
        new Set(normalized.map((answer) => answer.nodeId)).size !==
        normalized.length
      ) {
        throw new Error("Duplicate question.");
      }
      return { success: true, answers: normalized, notices: [] };
    } catch {
      return {
        success: false,
        error: "invalid-target-answer",
        message: "An answer does not match the current catalog.",
      };
    }
  }

  const migrationParsed = CatalogMigrationSchema.safeParse(migrationInput);
  if (!migrationParsed.success) {
    return {
      success: false,
      error: "unsupported-catalog-version",
      message: "No explicit migration is available for this catalog version.",
    };
  }
  const migration = migrationParsed.data;
  if (
    migration.fromVersion !== sourceVersion ||
    migration.toVersion !== catalog.version
  ) {
    return {
      success: false,
      error: "invalid-migration",
      message: "The migration does not match the source and current versions.",
    };
  }

  const nodeMap = new Map(
    migration.nodeMappings.map((mapping) => [mapping.from, mapping.to]),
  );
  const optionMap = new Map(
    migration.optionMappings.map((mapping) => [
      mapping.fromNodeId + ":" + mapping.fromOptionId,
      mapping,
    ]),
  );
  const targetNodes = new Map(catalog.nodes.map((node) => [node.id, node]));
  const migrated: InterviewAnswer[] = [];
  const notices: MigrationNotice[] = [];
  const seenNodeIds = new Set<string>();

  for (const answer of answers) {
    const mappedNodeId = nodeMap.has(answer.nodeId)
      ? nodeMap.get(answer.nodeId)
      : targetNodes.has(answer.nodeId)
        ? answer.nodeId
        : undefined;
    if (mappedNodeId === null) {
      notices.push({ answerNodeId: answer.nodeId, reason: "question-retired" });
      continue;
    }
    if (!mappedNodeId) {
      return {
        success: false,
        error: "invalid-migration",
        message: "A source question has no safe migration mapping.",
      };
    }
    const targetNode = targetNodes.get(mappedNodeId);
    if (!targetNode) {
      return {
        success: false,
        error: "invalid-migration",
        message:
          "A migration points to a question outside the current catalog.",
      };
    }
    if (seenNodeIds.has(mappedNodeId)) {
      return {
        success: false,
        error: "invalid-migration",
        message: "Two saved answers map to the same current question.",
      };
    }
    seenNodeIds.add(mappedNodeId);

    if (answer.skipped) {
      migrated.push({
        ...answer,
        nodeId: mappedNodeId,
        catalogVersion: catalog.version,
      });
      continue;
    }

    const mappedOptionIds: string[] = [];
    let customRetired = false;
    for (const optionId of answer.optionIds) {
      const explicit = optionMap.get(answer.nodeId + ":" + optionId);
      const targetOptionId = explicit
        ? explicit.toNodeId === mappedNodeId
          ? explicit.toOptionId
          : null
        : targetNode.options.some((option) => option.id === optionId)
          ? optionId
          : null;
      if (!targetOptionId) {
        notices.push({
          answerNodeId: answer.nodeId,
          reason: "selection-retired",
        });
        if (optionId === "custom" && answer.customAnswer) customRetired = true;
        continue;
      }
      if (!targetNode.options.some((option) => option.id === targetOptionId)) {
        return {
          success: false,
          error: "invalid-migration",
          message:
            "A migration points to an option outside the target question.",
        };
      }
      mappedOptionIds.push(targetOptionId);
    }
    if (customRetired || mappedOptionIds.length === 0) continue;
    const nextAnswer = {
      ...answer,
      nodeId: mappedNodeId,
      optionIds: mappedOptionIds,
      catalogVersion: catalog.version,
    };
    try {
      migrated.push(validateAnswerForNode(nextAnswer, targetNode));
    } catch {
      return {
        success: false,
        error: "invalid-target-answer",
        message: "A migrated answer does not fit the target question.",
      };
    }
  }
  return { success: true, answers: migrated, notices };
}
