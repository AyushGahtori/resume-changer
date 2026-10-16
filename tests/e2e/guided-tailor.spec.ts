import { expect, test } from "@playwright/test";
import { createResumeDraftHandoff } from "../helpers/resume-draft-handoff";

const jobDescription =
  "Standardize AWS provisioning with Infrastructure as Code.";
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

test("Guided Tailor requires approval and renders only the approved rewrite", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Cloud");
  await page.getByLabel("Role title").fill("Cloud Platform Engineer");
  await page.getByLabel("Job description").fill(jobDescription);
  await expect(page.getByRole("status")).toContainText("Saved locally");

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

  await page.getByRole("link", { name: "Resume builder" }).click();
  await Promise.all([
    page.waitForURL("**/generate?source=demo"),
    page.getByRole("link", { name: "Demo data", exact: true }).click(),
  ]);
  await page.getByLabel(`Select achievement ${achievementId}`).check();

  let tailoringRequest: unknown;
  await page.route("**/api/ai/tailor-achievements", async (route) => {
    tailoringRequest = route.request().postDataJSON();
    const requestJob = (
      tailoringRequest as {
        job: Parameters<typeof createResumeDraftHandoff>[0]["job"];
      }
    ).job;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: "The proposed wording aligns the point with the analyzed JD.",
        resumeSummary:
          "Delivered reliable AWS infrastructure with reusable deployment checks.",
        analyzedTerms: ["AWS provisioning", "Infrastructure as Code"],
        mode: "ai",
        handoff: createResumeDraftHandoff({
          achievementId,
          text: originalText,
          job: requestJob,
          groupId: "job-example-cloud-labs",
          groupTitle: "Cloud Platform Engineer",
        }),
        proposals: [
          {
            achievementId,
            originalText,
            proposedText,
            rationale:
              "The source confirms AWS provisioning and deployment checks.",
            addedTerms: ["Infrastructure as Code"],
          },
        ],
      }),
    });
  });

  await page.getByRole("button", { name: "Guided Tailor" }).click();
  const review = page.getByRole("region", { name: "Guided Tailor review" });
  await expect(review).toContainText(originalText);
  await expect(review).toContainText(proposedText);
  await expect(review).toContainText("Infrastructure as Code");
  const approval = review.getByRole("checkbox", {
    name: "Use tailored wording for this point",
  });
  await expect(approval).not.toBeChecked();
  expect(tailoringRequest).toMatchObject({
    dataSource: "demo",
    jobDescription,
    analysis,
    achievementIds: [achievementId],
    job: { contextId: expect.stringMatching(/^[a-f0-9]{64}$/) },
  });

  await review.getByRole("button", { name: "Approve all unchanged" }).click();
  await expect(approval).toBeChecked();
  await review.getByRole("button", { name: "Revoke all" }).click();
  await expect(approval).not.toBeChecked();

  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  const preview = page.getByLabel("Generated LaTeX");
  await expect(preview).toContainText(originalText);
  await expect(preview).not.toContainText("using Infrastructure as Code");
  await expect(preview).not.toContainText(
    "Delivered reliable AWS infrastructure",
  );

  await review
    .getByRole("checkbox", { name: "Use this generated summary" })
    .check();
  await approval.check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(preview).toContainText(proposedText);
  await expect(preview).toContainText("Delivered reliable AWS infrastructure");
  await expect(preview).not.toContainText(originalText);

  const editedText =
    "Standardized AWS environment provisioning and deployment checks for three internal services with Terraform modules.";
  await review
    .getByLabel(`Tailored wording for ${achievementId}`)
    .fill(editedText);
  await expect(approval).not.toBeChecked();
  await expect(
    review.getByRole("button", { name: "Approve all unchanged" }),
  ).toBeDisabled();
  await expect(page.getByLabel("Generated LaTeX")).toHaveCount(0);
  await approval.check();
  await page.getByRole("button", { name: "Generate LaTeX" }).click();
  await expect(page.getByLabel("Generated LaTeX")).toContainText(editedText);
});

test("Guided Tailor adds suggested evidence only after explicit user action", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Company").fill("Example Cloud");
  await page.getByLabel("Role title").fill("Cloud Platform Engineer");
  await page.getByLabel("Job description").fill(jobDescription);
  await expect(page.getByRole("status")).toContainText("Saved locally");

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
  await page.getByLabel(`Select achievement ${achievementId}`).check();

  const pipelineId = "achievement-ci-cd-pipeline";
  const pipelineText =
    "Built reusable CI/CD workflows that let application teams validate and release services without maintaining deployment scripts individually.";
  let requestCount = 0;
  let secondRequestIds: string[] = [];
  await page.route("**/api/ai/tailor-achievements", async (route) => {
    const request = route.request().postDataJSON() as {
      achievementIds: string[];
      job: {
        company: string;
        roleTitle: string;
        jobUrl: string;
        contextId: string;
      };
    };
    requestCount += 1;
    if (requestCount === 2) secondRequestIds = request.achievementIds;
    const selectedTextById: Record<string, string> = {
      [achievementId]: originalText,
      [pipelineId]: pipelineText,
    };
    const selectedAchievements = request.achievementIds.map((id) => ({
      achievementId: id,
      text: selectedTextById[id],
      section: "experience",
      groupId: "job-example-cloud-labs",
      groupTitle: "Platform Engineer",
      groupSubtitle: "Example Cloud Labs",
      linkedSkills: [],
      supportedRequirementIds:
        requestCount === 1 ? [] : ["requirement-responsibility-1"],
    }));
    const hasSuggestion = requestCount === 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: "Review the source-grounded wording before applying it.",
        analyzedTerms: ["AWS provisioning", "deployment workflows"],
        mode: "ai",
        proposals: request.achievementIds.map((id) => ({
          achievementId: id,
          originalText: selectedTextById[id],
          proposedText:
            id === achievementId
              ? proposedText
              : "Built reusable CI/CD workflows for service validation and releases.",
          rationale: "The original source point supports this wording.",
          addedTerms: id === achievementId ? ["Infrastructure as Code"] : [],
        })),
        handoff: {
          job: request.job,
          requirements: [
            {
              id: "requirement-responsibility-1",
              category: "responsibility",
              text: "Standardize deployment workflows",
              status: hasSuggestion ? "evidence-not-selected" : "supported",
              availableAchievementIds: [pipelineId],
              selectedAchievementIds: hasSuggestion
                ? []
                : request.achievementIds,
              reason: hasSuggestion
                ? "Potential source evidence exists in the library but was not selected."
                : "Selected source evidence directly supports this requirement.",
            },
          ],
          selectedAchievements,
          suggestedEvidence: hasSuggestion
            ? [
                {
                  achievementId: pipelineId,
                  text: pipelineText,
                  section: "experience",
                  groupId: "job-example-cloud-labs",
                  groupTitle: "Platform Engineer",
                  groupSubtitle: "Example Cloud Labs",
                  linkedSkills: ["Workflow Automation"],
                  supportedRequirementIds: ["requirement-responsibility-1"],
                },
              ]
            : [],
          contentBudgetLines: 24,
        },
      }),
    });
  });

  await page.getByRole("button", { name: "Guided Tailor" }).click();
  const review = page.getByRole("region", { name: "Guided Tailor review" });
  await expect(review).toContainText(pipelineText);
  await expect(
    page.getByLabel(`Select achievement ${pipelineId}`),
  ).not.toBeChecked();
  await review.getByRole("button", { name: "Add to selection" }).click();
  await expect(
    page.getByLabel(`Select achievement ${pipelineId}`),
  ).toBeChecked();
  await expect(page.locator(".auto-tailor-status")).toContainText(
    "Source selection updated",
  );
  await expect(review).toHaveCount(0);

  await page.getByRole("button", { name: "Guided Tailor" }).click();
  await expect(review).toContainText(originalText);
  await expect(review).toContainText(pipelineText);
  expect(secondRequestIds).toEqual([achievementId, pipelineId]);
});
