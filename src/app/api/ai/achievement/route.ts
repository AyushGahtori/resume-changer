import { protectAccountRoute } from "@/lib/cloud/protect-route";
import { NextResponse } from "next/server";
import { z } from "zod";
import { loadResumeLibrary } from "@/lib/data/loaders";
import { createAiProvider } from "@/lib/ai/provider-factory";
import { AiProviderError } from "@/lib/ai/provider";
import {
  AchievementWritingModeSchema,
  AchievementWritingResultSchema,
  validateWritingFacts,
  type AchievementWritingInput,
} from "@/lib/ai/achievement-writing";
import { StableIdSchema } from "@/lib/schemas/resume-data";
import { studioGroups } from "@/lib/generation/studio-document";
import { includesPhrase } from "@/lib/ai/requirement-coverage";
import { measureAchievementLines } from "@/lib/pdf/skill-measurements";

const RequestSchema = z
  .object({
    dataSource: z.enum(["personal", "demo"]),
    operation: z.enum(["edit", "merge", "create"]),
    destinationGroupId: StableIdSchema,
    sources: z
      .array(
        z
          .object({
            id: StableIdSchema,
            text: z.string().trim().min(1).max(8000),
            sourceAchievementIds: z.array(StableIdSchema).max(10),
          })
          .strict(),
      )
      .max(10),
    skillIds: z.array(StableIdSchema).max(10),
    draftText: z.string().max(8000),
    instruction: z.string().trim().min(1).max(2000),
    writingMode: AchievementWritingModeSchema.optional(),
    targetLines: z.number().int().min(1).max(8).optional(),
  })
  .strict();
export const runtime = "nodejs";

async function POSTForAccount(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Provide a valid writing request." },
      { status: 400 },
    );
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Check the connected context and writing instruction." },
      { status: 400 },
    );
  const data = parsed.data;
  if (data.operation === "create" && data.instruction.length > 500)
    return NextResponse.json(
      { error: "Keep the writing instruction to 500 characters or fewer." },
      { status: 400 },
    );
  if (data.operation !== "create" && data.writingMode)
    return NextResponse.json(
      { error: "Writing modes are available for create requests only." },
      { status: 400 },
    );
  if (
    data.sources.length + data.skillIds.length > 10 ||
    new Set(data.sources.map((source) => source.id)).size !==
      data.sources.length ||
    new Set(data.skillIds).size !== data.skillIds.length
  )
    return NextResponse.json(
      { error: "Connect up to ten distinct context items." },
      { status: 400 },
    );
  if (
    (data.operation === "edit" && data.sources.length !== 1) ||
    (data.operation === "merge" &&
      (data.sources.length < 2 ||
        data.sources.length > 3 ||
        new Set(
          data.sources.flatMap((source) =>
            source.sourceAchievementIds.length
              ? source.sourceAchievementIds
              : [source.id],
          ),
        ).size > 3))
  )
    return NextResponse.json(
      {
        error:
          "Edit one achievement, or merge two or three original achievements.",
      },
      { status: 400 },
    );
  if (
    data.operation === "create" &&
    !data.draftText.trim() &&
    data.sources.length === 0
  )
    return NextResponse.json(
      {
        error:
          "Write a factual draft or connect an achievement before asking Imagination.",
      },
      { status: 400 },
    );
  try {
    const library = await loadResumeLibrary({ source: data.dataSource });
    const destination = studioGroups(library).find(
      (group) => group.id === data.destinationGroupId,
    );
    if (!destination)
      return NextResponse.json(
        { error: "Choose an existing destination." },
        { status: 400 },
      );
    const points = new Map(
      [...library.jobs, ...library.projects].flatMap((group) =>
        group.points.map(
          (point) => [point.id, { ...point, groupId: group.id }] as const,
        ),
      ),
    );
    if (
      data.sources.some((source) =>
        source.sourceAchievementIds.some(
          (id) => !points.has(id) || points.get(id)!.groupId !== destination.id,
        ),
      )
    )
      return NextResponse.json(
        {
          error:
            "Connect achievements from the destination company or project to preserve attribution.",
        },
        { status: 400 },
      );
    const skillNames = data.skillIds.map(
      (id) => library.skills.find((skill) => skill.id === id)?.name,
    );
    if (skillNames.some((name) => !name))
      return NextResponse.json(
        { error: "A connected skill is no longer available." },
        { status: 400 },
      );
    const input: AchievementWritingInput = {
      sources: data.sources.map((source) => ({
        id: source.id,
        text: source.text,
        factualConstraints: source.sourceAchievementIds.map((id) => {
          const point = points.get(id)!;
          return [
            point.text,
            ...point.metrics.map(
              (metric) =>
                `${metric.label}: ${metric.value}${metric.unit ? ` ${metric.unit}` : ""}. ${metric.evidence}`,
            ),
          ].join(" ");
        }),
      })),
      skills: skillNames as string[],
      draftText: data.draftText,
      instruction: data.instruction,
      ...(data.writingMode ? { writingMode: data.writingMode } : {}),
      destination: `${destination.title} · ${destination.subtitle}`,
      targetLines: data.targetLines,
    };
    const provider = createAiProvider();
    if (!provider.writeAchievement)
      return NextResponse.json(
        {
          error:
            "Imagination is unavailable with the selected provider. You can continue editing manually.",
        },
        { status: 503 },
      );
    let result = AchievementWritingResultSchema.parse(
      await provider.writeAchievement(data.operation, input),
    );
    const error = validateWritingFacts(input, result);
    if (error) return NextResponse.json({ error }, { status: 422 });
    const suppliedFacts = [
      input.draftText,
      ...input.skills,
      ...input.sources.flatMap((item) => [
        item.text,
        ...item.factualConstraints,
      ]),
    ].join(" ");
    const unknownSkill = (text: string) =>
      library.skills.find(
        (skill) =>
          skill.name.length > 2 &&
          [skill.name, ...skill.aliases].some((name) =>
            includesPhrase(text, name),
          ) &&
          ![skill.name, ...skill.aliases].some((name) =>
            includesPhrase(suppliedFacts, name),
          ),
      );
    const unsupportedSkill = unknownSkill(result.text);
    if (unsupportedSkill)
      return NextResponse.json(
        {
          error: `The suggestion added ${unsupportedSkill.name} without connected evidence. Retry or connect the relevant context.`,
        },
        { status: 422 },
      );
    let measuredLines = await measureAchievementLines(result.text).catch(
      () => null,
    );
    if (data.targetLines && measuredLines && measuredLines > data.targetLines) {
      const retry = AchievementWritingResultSchema.parse(
        await provider.writeAchievement(data.operation, {
          ...input,
          instruction: `${input.instruction}\nThe prior version compiled to ${measuredLines} template lines. Aim for ${data.targetLines} lines while preserving every fact and metric. Do not truncate information or add claims.`,
        }),
      );
      if (!validateWritingFacts(input, retry) && !unknownSkill(retry.text)) {
        const retryLines = await measureAchievementLines(retry.text).catch(
          () => null,
        );
        if (retryLines && retryLines < measuredLines) {
          result = retry;
          measuredLines = retryLines;
        }
      }
    }
    return NextResponse.json(
      {
        ...result,
        provider: provider.name,
        measuredLines,
        layoutWarning:
          measuredLines === null
            ? "Line count could not be compiled. Final fit will be checked on Apply."
            : data.targetLines && measuredLines > data.targetLines
              ? `This version compiles to ${measuredLines} lines; the ${data.targetLines}-line target was not reached. Refine the draft or try another instruction.`
              : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return NextResponse.json(
        {
          error:
            "Imagination returned an invalid suggestion. Your draft is preserved. Try again.",
        },
        { status: 422 },
      );
    return NextResponse.json(
      {
        error:
          error instanceof AiProviderError
            ? error.message
            : "Imagination could not prepare a suggestion. Your draft is preserved. Try again.",
      },
      {
        status:
          error instanceof AiProviderError && error.code === "INVALID_RESPONSE"
            ? 422
            : 503,
      },
    );
  }
}

export const POST = protectAccountRoute(POSTForAccount);
