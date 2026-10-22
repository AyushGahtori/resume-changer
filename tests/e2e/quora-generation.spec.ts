import { expect, test } from "@playwright/test";
import { copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { JD_DRAFT_STORAGE_KEY } from "../../src/lib/jd-draft";
import {
  createPersonalLibraryGuard,
  exampleLibraryPath,
  personalLibraryPath,
} from "./support/personal-library";

const QUORA_JOB_DESCRIPTION = String.raw`Quora operates in the knowledge sharing and artificial intelligence space, addressing the challenge of organizing and distributing collective intelligence on a global scale. The organization provides two main platforms: a knowledge sharing site with millions of monthly users, and a cloud workspace for running AI agents collaboratively. This setup supports a wide user base and integrates multiple AI models, highlighting the company's emphasis on leveraging machine learning to enhance information access and collaboration.

About the Opportunity:

The SOFTWARE ENGINEER NEW GRAD, MACHINE LEARNING PLATFORM role focuses on developing and maintaining the infrastructure that supports large-scale machine learning models. This position contributes directly to the reliability, efficiency, and scalability of ML systems that serve hundreds of millions of users, enabling machine learning engineers to work more effectively. The role offers hands-on experience with distributed systems, GPU serving, and ML platform modernization, impacting the long-term success of the organization's core products.

Responsibilities:
- Build and maintain core infrastructure for the machine learning platform ensuring availability and scalability
- Develop distributed systems for serving diverse machine learning models in production
- Optimize GPU model serving to improve latency, throughput, and cost efficiency
- Contribute to platform standardization and modernization efforts
- Create tools to enhance machine learning engineer productivity
- Modernize feature store for faster feature deployment
- Participate in on-call rotations to manage production issues

Requirements:
- Availability during coordination hours (Monday to Friday, 9am to 3pm Pacific Time)
- Expected 2025 or 2026 graduate in Computer Science, Engineering, or related technical field
- Interest in large-scale distributed systems and machine learning infrastructure
- Familiarity or ability to learn Python, Go, or C++
- Commitment to continuous learning and team improvement

Pay Range and Compensation Package:
- For US-based applicants, the salary is $97,600

Benefits & Perks:
- Medical insurance
- Vision insurance
- Dental insurance

Equal Opportunity Statement: Our client is an equal opportunity employer. They celebrate diversity and are committed to creating an inclusive environment for all employees. All qualified applicants will receive consideration for employment without regard to race, color, religion, gender, gender identity or expression, sexual orientation, or national origin.

Note:
TalentHop is a recruitment partner of this role. Please note that all employment decisions, including candidate assessment, interviews, hiring, compensation, and employment terms, are made exclusively by the hiring employer.

Benefits found in job post: Medical insurance, Vision insurance, Dental insurance`;

const SELECTED_POINT_IDS = [
  "achievement-service-capacity-design",
  "achievement-cloud-deployment-platform",
  "achievement-ci-cd-pipeline",
];

// Other library specs write synthetic personal data into the shared test root.
// This flow must always start from the sample library that contains its three IDs.
const personalLibrary = createPersonalLibraryGuard();

test.beforeAll(async () => {
  await personalLibrary.capture();
  await mkdir(dirname(personalLibraryPath), { recursive: true });
  await copyFile(exampleLibraryPath, personalLibraryPath);
});

test.afterAll(async () => {
  await personalLibrary.restore();
});

test("uses the Quora JD to generate expected LaTeX from three selected points", async ({
  page,
}) => {
  await page.addInitScript(
    ({ storageKey, draft }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(draft));
    },
    {
      storageKey: JD_DRAFT_STORAGE_KEY,
      draft: {
        schemaVersion: 1,
        company: "Quora",
        roleTitle: "Software Engineer New Grad, Machine Learning Platform",
        jobUrl: "",
        jobDescription: QUORA_JOB_DESCRIPTION,
      },
    },
  );

  await page.goto("/generate");
  await expect(page.locator(".generation-draft")).toContainText("Quora");
  await expect(page.locator(".generation-draft")).toContainText(
    "Software Engineer New Grad, Machine Learning Platform",
  );
  await expect(page.locator(".generation-draft")).toContainText(
    `${QUORA_JOB_DESCRIPTION.length.toLocaleString()} description characters`,
  );

  for (const id of SELECTED_POINT_IDS) {
    await page.getByLabel(`Select achievement ${id}`).check();
  }
  await page.getByRole("button", { name: "Generate LaTeX" }).click();

  await expect(page.locator(".generation-metadata")).toContainText(
    "3 achievements",
  );
  await expect(page.locator(".generation-metadata")).toContainText(
    "10 skills shown",
  );
  const latex = page.locator(".latex-preview code");
  await expect(latex).toContainText("\\ResumeHeader{Jordan Example}");
  await expect(latex).toContainText(
    "Redesigned service boundaries and capacity planning",
  );
  const renderedLatex = await latex.innerText();
  await expect(renderedLatex.replace(/\r\n/g, "\n")).toMatchSnapshot(
    "quora-manual-generation.tex",
  );
});

