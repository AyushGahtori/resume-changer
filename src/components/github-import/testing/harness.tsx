"use client";

import { useState } from "react";
import { AchievementReview } from "../achievement-review";
import { AnalysisStatus } from "../analysis-status";
import { EvidencePanel } from "../evidence-panel";
import {
  EvidenceChip,
  ImportButton,
  ImportInfoBanner,
  ImportStatusPill,
} from "../import-primitives";
import { ImportLayout } from "../import-layout";
import { ImportNotifications } from "../../library/import-notifications";
import type { ImportProgressItem } from "../../library/import-status-provider";
import { MeasurementFields } from "../measurement-fields";
import { RepositorySetup } from "../repository-setup";
import { ImportTrustRail } from "../trust-rail";
import {
  achievementReviewProps,
  analysisStatusProps,
  evidenceProps,
  measurementFieldsProps,
  notificationsProps,
  setupProps,
  trustRailProps,
} from "./fixtures";
import type {
  AchievementReviewProps,
  AnalysisStatusProps,
  EvidencePanelProps,
  ImportLayoutProps,
  ImportLifecycle,
  ImportNotificationsProps,
  ImportStep,
  ImportTrustRailProps,
  MeasurementFieldsProps,
  RepositorySetupProps,
} from "../../../lib/github/contracts";

type HarnessCase =
  | {
      id: string;
      title: string;
      component: "primitives";
      state: ImportLifecycle;
    }
  | {
      id: string;
      title: string;
      component: "setup";
      props: RepositorySetupProps;
    }
  | {
      id: string;
      title: string;
      component: "evidence";
      props: EvidencePanelProps;
    }
  | {
      id: string;
      title: string;
      component: "review";
      props: AchievementReviewProps;
    }
  | {
      id: string;
      title: string;
      component: "measurement";
      props: MeasurementFieldsProps;
    }
  | {
      id: string;
      title: string;
      component: "trust";
      props: ImportTrustRailProps;
    }
  | {
      id: string;
      title: string;
      component: "status";
      props: AnalysisStatusProps;
    }
  | {
      id: string;
      title: string;
      component: "notifications";
      props: ImportNotificationsProps & {
        projectNames?: Readonly<Record<string, string>>;
        runningImports?: ImportProgressItem[];
      };
    }
  | { id: string; title: string; component: "layout"; state: ImportStep };

function buildCases(): HarnessCase[] {
  const baseNotifications = notificationsProps("unread");
  const baseNotification = baseNotifications.items[0];
  const multipleNotifications = baseNotification
    ? {
        ...baseNotifications,
        items: [
          {
            ...baseNotification,
            id: "task-28-ready-long-project",
            importId: "task-28-ready-run",
            projectId: "task-28-long-project",
          },
          {
            ...baseNotification,
            id: "task-28-read-long-project",
            importId: "task-28-read-run",
            projectId: "task-28-long-project",
            readAt: "2026-10-26T12:00:00.000Z",
          },
          {
            ...baseNotification,
            id: "task-28-failed-long-project",
            importId: "task-28-failed-run",
            projectId: "task-28-long-project",
            type: "failed" as const,
          },
          {
            ...baseNotification,
            id: "task-28-expired-long-project",
            importId: "task-28-expired-run",
            projectId: "task-28-long-project",
            type: "expired" as const,
          },
        ],
        unreadCount: 3,
        projectNames: {
          "task-28-long-project": "Long Cross Platform Data Processing Project",
        },
        runningImports: [
          {
            importId: "task-28-running-one",
            projectId: "task-28-long-project",
            lifecycle: "queued" as const,
            updatedAt: "2026-10-27T11:58:00.000Z",
          },
          {
            importId: "task-28-running-two",
            projectId: "task-28-long-project",
            lifecycle: "analyzing" as const,
            updatedAt: "2026-10-27T11:59:00.000Z",
          },
        ],
      }
    : baseNotifications;
  const cases: HarnessCase[] = [
    {
      id: "primitives-ready",
      title: "Task 21 · ready primitives",
      component: "primitives",
      state: "ready-to-review",
    },
    {
      id: "primitives-error",
      title: "Task 21 · error primitives",
      component: "primitives",
      state: "failed",
    },
    {
      id: "setup-ready",
      title: "Task 22 · selected repository and PRs",
      component: "setup",
      props: setupProps("ready"),
    },
    {
      id: "setup-empty",
      title: "Task 22 · no repositories",
      component: "setup",
      props: setupProps("empty"),
    },
    {
      id: "setup-private-denied",
      title: "Task 22 · private access denied",
      component: "setup",
      props: setupProps("private-denied"),
    },
    {
      id: "evidence-safe",
      title: "Task 23 · safe evidence",
      component: "evidence",
      props: evidenceProps("safe"),
    },
    {
      id: "evidence-blocked",
      title: "Task 23 · blocked candidate",
      component: "evidence",
      props: evidenceProps("blocked"),
    },
    {
      id: "evidence-manual",
      title: "Task 23 · manually pinned file",
      component: "evidence",
      props: evidenceProps("manual"),
    },
    {
      id: "review-supported",
      title: "Task 24 · supported draft",
      component: "review",
      props: achievementReviewProps("supported"),
    },
    {
      id: "review-needs-context",
      title: "Task 24 · needs context",
      component: "review",
      props: achievementReviewProps("needs-context"),
    },
    {
      id: "measurement-result",
      title: "Task 25 · measured result",
      component: "measurement",
      props: measurementFieldsProps("measured"),
    },
    {
      id: "measurement-skip",
      title: "Task 25 · qualitative skip",
      component: "measurement",
      props: measurementFieldsProps("no-metric"),
    },
    {
      id: "measurement-target",
      title: "Task 25 · target stays unachieved",
      component: "measurement",
      props: measurementFieldsProps("target"),
    },
    {
      id: "trust-within-budget",
      title: "Task 26 · within budget",
      component: "trust",
      props: trustRailProps(false),
    },
    {
      id: "trust-over-budget",
      title: "Task 26 · over budget",
      component: "trust",
      props: trustRailProps(true),
    },
    {
      id: "status-queued",
      title: "Task 27 · queued",
      component: "status",
      props: analysisStatusProps("queued"),
    },
    {
      id: "status-running",
      title: "Task 27 · running",
      component: "status",
      props: analysisStatusProps("analyzing"),
    },
    {
      id: "status-ready",
      title: "Task 27 · ready to review",
      component: "status",
      props: analysisStatusProps("ready-to-review"),
    },
    {
      id: "status-failed",
      title: "Task 27 · failed",
      component: "status",
      props: analysisStatusProps("failed"),
    },
    {
      id: "status-interrupted",
      title: "Task 27 · interrupted",
      component: "status",
      props: analysisStatusProps("interrupted"),
    },
    {
      id: "notifications-read",
      title: "Task 28 · read notification",
      component: "notifications",
      props: notificationsProps("read"),
    },
    {
      id: "notifications-unread",
      title: "Task 28 · unread notification",
      component: "notifications",
      props: notificationsProps("unread"),
    },
    {
      id: "notifications-expired",
      title: "Task 28 · expired result",
      component: "notifications",
      props: notificationsProps("expired"),
    },
    {
      id: "notifications-multiple",
      title: "Task 28 · multiple runs and long project name",
      component: "notifications",
      props: multipleNotifications,
    },
    {
      id: "layout-setup",
      title: "Task 29 · setup layout",
      component: "layout",
      state: "setup",
    },
    {
      id: "layout-analysis",
      title: "Task 29 · analysis layout",
      component: "layout",
      state: "analysis",
    },
    {
      id: "layout-review",
      title: "Task 29 · review layout",
      component: "layout",
      state: "review",
    },
  ];
  return cases;
}

function renderCase(item: HarnessCase) {
  switch (item.component) {
    case "primitives":
      return (
        <div data-testid="github-import-harness-case-content">
          <ImportButton label="Connect GitHub" variant="primary" />
          <ImportStatusPill state={item.state} label={item.state} />
          <ImportInfoBanner
            title="Review before sharing"
            description="Only the selected excerpts will be sent for analysis."
            tone={item.state === "failed" ? "error" : "info"}
          />
          <EvidenceChip
            label="summary.ts"
            category="implementation"
            state="included"
          />
        </div>
      );
    case "setup":
      return <RepositorySetup {...item.props} />;
    case "evidence":
      return <EvidencePanel {...item.props} />;
    case "review":
      return <AchievementReview {...item.props} />;
    case "measurement":
      return <MeasurementFields {...item.props} />;
    case "trust":
      return <ImportTrustRail {...item.props} />;
    case "status":
      return <AnalysisStatus {...item.props} />;
    case "notifications":
      return <ImportNotifications {...item.props} />;
    case "layout": {
      const layoutProps: ImportLayoutProps = {
        header: <h2>Fictional dashboard import</h2>,
        progress: <p>Setup · Analysis · Review</p>,
        main: <p>Synthetic {item.state} fixture state.</p>,
        rail: <p>Evidence and run status</p>,
        actions: <button type="button">Continue</button>,
        state: item.state,
      };
      return <ImportLayout {...layoutProps} />;
    }
  }
}

export function ImportComponentHarness() {
  const [cases] = useState(buildCases);
  const [selectedId, setSelectedId] = useState(cases[0]?.id ?? "");
  const selected = cases.find((item) => item.id === selectedId) ?? cases[0];

  if (!selected) return <p>No fixture cases are registered.</p>;

  return (
    <main data-testid="github-import-harness-root">
      <h1>GitHub import component harness</h1>
      <p>
        Synthetic fixtures only. No GitHub, provider, filesystem, or approval
        calls.
      </p>
      <label>
        Fixture case
        <select
          aria-label="Choose GitHub import fixture"
          value={selected.id}
          onChange={(event) => setSelectedId(event.currentTarget.value)}
        >
          {cases.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
      </label>
      <section
        data-testid="github-import-harness-case"
        data-case-id={selected.id}
      >
        <h2>{selected.title}</h2>
        {renderCase(selected)}
      </section>
    </main>
  );
}
