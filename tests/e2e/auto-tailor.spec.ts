import { expect, test } from "@playwright/test";
import { createResumeDraftHandoff } from "../helpers/resume-draft-handoff";

const jobDescription = "Provision AWS services with Terraform.";
const analysis = {
  targetTitle: "Cloud Platform Engineer",
  seniority: "Early career",
  requiredQualifications: ["AWS provisioning"],
  preferredQualifications: [],
  responsibilities: ["Standardize deployment workflows"],
  toolsAndPlatforms: ["AWS", "Terraform"],
  domainConcepts: ["Cloud infrastructure"],
  atsTerms: ["Infrastructure as Code"],
  inferredContext: [],
  terminology: [],
};
const achievementId = "achievement-cloud-deployment-platform";
const originalText =
  "Standardized AWS environment provisioning and deployment checks for three internal services.";
const proposedText =
  "Standardized AWS environment provisioning and deployment checks for three internal services using Infrastructure as Code.";

function createOnePagePdf() {
  const stream = "BT /F1 24 Tf 72 720 Td (Auto Tailor Preview Test) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let source = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(source));
    source += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(source);
  source += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  source += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  source += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(source);
}

test("Auto Tailor selects, drafts, generates, and verifies a one-page PDF", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Cloud");
  await page.getByLabel("Role title").fill("Cloud Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill(jobDescription);
  await expect(page.getByRole("status")).toContainText("Saved on this device");

  await page.route("**/api/ai/analyze-job-description", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis }),
    });
  });
  await page.getByRole("button", { name: "Analyze job description" }).click();
  await expect(
    page.getByRole("region", { name: "Job description analysis" }),
  ).toBeVisible();
  await page.goto("/generate?source=demo");

  let autoRequest:
    | {
        job: {
          company: string;
          roleTitle: string;
          jobUrl: string;
          contextId: string;
        };
      }
    | undefined;
  let generationRequest: Record<string, unknown> | undefined;
  await page.route("**/api/ai/auto-tailor", async (route) => {
    autoRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        recommendation: {
          recommendations: {
            selections: [
              {
                achievementId,
                section: "experience",
                confidence: 0.94,
                rationale: "Direct evidence of AWS provisioning work.",
              },
            ],
            requirementCoverage: [
              {
                requirement: "AWS provisioning",
                coveredByAchievementIds: [achievementId],
              },
            ],
            skillRecommendations: [],
            confidence: 0.94,
            summary: "Selected source evidence for the role.",
          },
          mode: "ai",
          budget: { availableLines: 20, usedLines: 5 },
        },
        tailoring: {
          proposals: [
            {
              achievementId,
              originalText,
              proposedText,
              rationale: "The linked skill evidence supports this phrase.",
              addedTerms: ["Infrastructure as Code"],
            },
          ],
          summary: "The selected source point was tailored.",
          analyzedTerms: ["AWS provisioning", "Infrastructure as Code"],
          mode: "ai",
          handoff: createResumeDraftHandoff({
            achievementId,
            text: originalText,
            job: autoRequest?.job,
            groupId: "job-example-cloud-labs",
            groupTitle: "Cloud Platform Engineer",
          }),
        },
        selectedSkillIds: [],
        draftingMode: "ai",
      }),
    });
  });
  await page.route("**/api/generate", async (route) => {
    generationRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        latex: `\\documentclass{article}\n${proposedText}`,
        metadata: {
          id: "auto-test",
          generatedAt: new Date().toISOString(),
          dataSource: "demo",
          company: "Example Cloud",
          roleTitle: "Cloud Platform Engineer",
          jobUrl: "",
          selectedAchievementIds: [achievementId],
          tailoringMode: "auto",
          sourceProvenance: [],
          renderedSkillIds: [],
        },
      }),
    });
  });
  await page.route("**/api/compile", async (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/pdf",
      headers: { "X-PDF-Pages": "1" },
      body: createOnePagePdf(),
    }),
  );

  await page.getByRole("button", { name: "Auto Tailor" }).click();
  await expect(page.locator(".auto-tailor-status")).toContainText(
    "Auto Tailor completed and the one-page PDF was verified.",
  );
  await expect(page.getByText("PDF ready · 1 page.")).toBeVisible();
  expect(autoRequest).toMatchObject({
    dataSource: "demo",
    jobDescription,
    analysis,
    job: { contextId: expect.stringMatching(/^[a-f0-9]{64}$/) },
  });
  expect(generationRequest).toMatchObject({
    tailoringMode: "auto",
    selectedAchievementIds: [achievementId],
    achievementTextOverrides: [{ achievementId, text: proposedText }],
  });

  await page.getByRole("tab", { name: "LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(proposedText);
});

test("local matching is offered only after explaining the AI failure and requesting consent", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Cloud");
  await page.getByLabel("Role title").fill("Cloud Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill(jobDescription);
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await page.route("**/api/ai/analyze-job-description", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis }),
    }),
  );
  await page.getByRole("button", { name: "Analyze job description" }).click();
  await expect(
    page.getByRole("region", { name: "Job description analysis" }),
  ).toBeVisible();
  await expect(page.locator(".analysis-cache-notice")).toHaveCount(0);
  await page.goto("/generate?source=demo");

  const requestBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/ai/select-achievements", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requestBodies.push(body);
    if (requestBodies.length === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Gemini's free-tier request limit was reached.",
          code: "RATE_LIMITED",
          retryable: true,
          fallbackAvailable: true,
          fallbackType: "local-matching",
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "local-fallback",
        notice: "Local matching suggestions are available for review.",
        recommendations: {
          selections: [],
          requirementCoverage: [],
          skillRecommendations: [],
          confidence: 0.3,
          summary: "Local matching results.",
        },
        budget: { availableLines: 20, usedLines: 0 },
      }),
    });
  });

  let confirmationMessage = "";
  page.once("dialog", async (dialog) => {
    confirmationMessage = dialog.message();
    await dialog.accept();
  });
  const suggestButton = page.getByRole("button", { name: "Suggest points" });
  await expect(suggestButton).toBeEnabled();
  await suggestButton.click();
  await expect.poll(() => requestBodies).toHaveLength(2);
  expect(confirmationMessage).toContain(
    "Gemini's free-tier request limit was reached.",
  );
  expect(confirmationMessage).toContain("Continue with local-matching?");
  expect(requestBodies[0]).not.toHaveProperty("allowLocalFallback", true);
  expect(requestBodies[1]).toMatchObject({ allowLocalFallback: true });
});

test("Auto Tailor reports wording repair and exposes summary, partial coverage and inference", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Cloud");
  await page.getByLabel("Role title").fill("Cloud Platform Engineer");
  await page
    .getByRole("textbox", { name: "Job description", exact: true })
    .fill(jobDescription);
  await expect(page.getByRole("status")).toContainText("Saved on this device");
  await page.route("**/api/ai/analyze-job-description", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ analysis }),
    }),
  );
  await page.getByRole("button", { name: "Analyze job description" }).click();
  await expect(
    page.getByRole("region", { name: "Job description analysis" }),
  ).toBeVisible();
  await page.goto("/generate?source=demo");
  let repeatedGeneration = 0;
  await page.route("**/api/generate", (route) => {
    repeatedGeneration++;
    return route.abort();
  });
  await page.route("**/api/compile", (route) => {
    repeatedGeneration++;
    return route.abort();
  });
  await page.route("**/api/ai/auto-tailor", async (route) => {
    const request = route.request().postDataJSON();
    expect(request.generatePdf).toBe(true);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        recommendation: {
          recommendations: {
            selections: [
              {
                achievementId,
                section: "experience",
                confidence: 0.9,
                rationale: "Supported job work.",
              },
            ],
            requirementCoverage: [
              {
                requirement: "AWS provisioning",
                coveredByAchievementIds: [achievementId],
              },
            ],
            skillRecommendations: [],
            confidence: 0.9,
            summary: "Selected relevant work.",
          },
          mode: "ai",
          budget: { availableLines: 40, usedLines: 10 },
        },
        tailoring: {
          proposals: [
            {
              achievementId,
              originalText,
              proposedText,
              rationale: "Preserved outcomes.",
              addedTerms: [],
              inferredTerms: ["TensorFlow"],
            },
          ],
          summary: "Drafted source achievements.",
          resumeSummary:
            "Delivered reliable cloud services with source-backed outcomes.",
          qualityNotes: [
            "Inferred framework usage: TensorFlow. Review this assumption.",
          ],
          analyzedTerms: [],
          mode: "ai",
          handoff: createResumeDraftHandoff({
            achievementId,
            text: originalText,
            job: request.job,
            groupId: "job-example-cloud-labs",
            groupTitle: "Cloud Platform Engineer",
          }),
        },
        selectedSkillIds: [],
        draftingMode: "ai",
        compiled: {
          latex: "Verified measured LaTeX",
          pdfBase64: createOnePagePdf().toString("base64"),
          metadata: {
            id: "measured-result",
            generatedAt: new Date().toISOString(),
            dataSource: "demo",
            company: "Example Cloud",
            roleTitle: "Cloud Platform Engineer",
            jobUrl: "",
            tailoringMode: "auto",
            selectedAchievementIds: [achievementId],
            selectedSkillIds: [],
            renderedSkillIds: [],
            sourceProvenance: [],
            generatedBullets: [
              {
                achievementId,
                sourceAchievementIds: [achievementId],
                text: originalText,
                inferredTerms: ["TensorFlow"],
              },
            ],
            resumeSummary:
              "Delivered reliable cloud services with source-backed outcomes.",
            visibleWordCount: 520,
            layout: { utilization: 0.97 },
            fitting: {
              attempts: 2,
              repairAttempts: 1,
              decisions: [],
              status: "filled",
            },
            qualityReport: {
              machine: [
                {
                  id: "identity",
                  status: "pass",
                  message: "Name and email are readable.",
                },
              ],
              recruiter: [
                {
                  id: "top-third-relevance",
                  status: "review",
                  message: "Move AWS evidence into the visible opening.",
                },
              ],
              credibility: [
                {
                  id: "inference",
                  status: "review",
                  message: "Confirm inferred TensorFlow use.",
                },
              ],
            },
            finalCoverage: [
              {
                requirement: "AWS provisioning",
                coveredByAchievementIds: [achievementId],
                availableAchievementIds: [achievementId],
                status: "partial",
                evidence: [],
                missingComponents: ["More deployment evidence"],
                reason: "Related evidence supports part of the requirement.",
              },
            ],
          },
        },
      }),
    });
  });
  await page.getByRole("button", { name: "Auto Tailor", exact: true }).click();
  await expect(
    page.getByText(
      "Auto Tailor completed with a verified one-page PDF and measured page fill. Wording repair used 1 time.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      "PDF ready · 1 page · 97% page fill. Wording repair used 1 time.",
    ),
  ).toBeVisible();
  await page.getByText("Final resume checks · 2 need review").click();
  await expect(
    page.getByText("Move AWS evidence into the visible opening."),
  ).toBeVisible();
  await expect(
    page.getByText("Confirm inferred TensorFlow use."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Job match", exact: true }).click();
  await expect(
    page.getByText("0 / 1 supported · 1 partial", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Inferred framework usage: TensorFlow. Review this assumption.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByLabel("Resume summary", { exact: true })).toHaveValue(
    "Delivered reliable cloud services with source-backed outcomes.",
  );
  expect(repeatedGeneration).toBe(0);
});
