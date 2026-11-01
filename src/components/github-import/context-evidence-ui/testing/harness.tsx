"use client";

import { useMemo, useState } from "react";
import { ContextEvidenceUi } from "../context-evidence-ui";
import {
  buildEvidenceUiEntries,
  evidenceUiAllocations,
  evidenceUiMissingFeatures,
  type EvidenceFixtureState,
} from "./fixtures";
import type { EvidenceInventoryEntry } from "../types";
import styles from "./harness.module.css";

const FIXTURE_STATES: EvidenceFixtureState[] = [
  "default",
  "full",
  "stale",
  "empty",
  "large",
];

function selectedToEligible(
  entry: Extract<EvidenceInventoryEntry, { state: "selected" }>,
): EvidenceInventoryEntry {
  const {
    state: _state,
    stale: _stale,
    staleReason: _reason,
    preview: _preview,
    ...base
  } = entry;
  return { ...base, state: "eligible" };
}

export function ContextEvidenceHarness() {
  const [fixture, setFixture] = useState<EvidenceFixtureState>("default");
  const [entries, setEntries] = useState<EvidenceInventoryEntry[]>(() =>
    buildEvidenceUiEntries("default"),
  );
  const [selectionEdited, setSelectionEdited] = useState(false);
  const allocations = useMemo(
    () =>
      evidenceUiAllocations.map((allocation) => ({
        ...allocation,
        selectedFiles: entries.filter(
          (entry) =>
            entry.state === "selected" && entry.role === allocation.role,
        ).length,
      })),
    [entries],
  );

  function loadFixture(nextFixture: EvidenceFixtureState) {
    setFixture(nextFixture);
    setEntries(buildEvidenceUiEntries(nextFixture));
    setSelectionEdited(false);
  }

  function add(entryId: string) {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === entryId && entry.state === "eligible"
          ? { ...entry, state: "selected" }
          : entry,
      ),
    );
    setSelectionEdited(true);
  }

  function remove(entryId: string) {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === entryId && entry.state === "selected"
          ? selectedToEligible(entry)
          : entry,
      ),
    );
    setSelectionEdited(true);
  }

  function replace({
    incomingId,
    replacingId,
  }: {
    incomingId: string;
    replacingId: string;
  }) {
    setEntries((current) =>
      current.map((entry) => {
        if (entry.id === incomingId && entry.state === "eligible") {
          return { ...entry, state: "selected" };
        }
        if (entry.id === replacingId && entry.state === "selected") {
          return selectedToEligible(entry);
        }
        return entry;
      }),
    );
    setSelectionEdited(true);
  }

  return (
    <main className={styles.harness} data-testid="context-evidence-harness">
      <header className={styles.harnessHeader}>
        <div>
          <p className={styles.harnessEyebrow}>Standalone UI fixture</p>
          <h1>Evidence inventory preview</h1>
          <p>
            Synthetic records only. Selection actions stay in this page and do
            not call GitHub, a provider, storage, or approval services.
          </p>
        </div>
        <label className={styles.fixtureSelect}>
          <span>Choose fixture state</span>
          <select
            value={fixture}
            onChange={(event) =>
              loadFixture(event.currentTarget.value as EvidenceFixtureState)
            }
            aria-label="Choose evidence fixture state"
          >
            {FIXTURE_STATES.map((state) => (
              <option value={state} key={state}>
                {state === "default"
                  ? "Mixed inventory"
                  : state === "full"
                    ? "Full bundle"
                    : state === "stale"
                      ? "Stale selection"
                      : state === "empty"
                        ? "Empty inventory"
                        : "10,000 files"}
              </option>
            ))}
          </select>
        </label>
      </header>
      <ContextEvidenceUi
        entries={entries}
        inventoryCount={entries.length}
        inventoryStatus={{
          completeness: fixture === "empty" ? "complete" : "partial",
          ...(fixture !== "empty"
            ? { note: "The repository tree reached a bounded inventory page." }
            : {}),
        }}
        maxSelectedFiles={5}
        allocations={allocations}
        missingFeatures={evidenceUiMissingFeatures}
        staleSelectionMessage={
          selectionEdited
            ? "The selection changed after preparation. Prepare the new bundle and review consent before analysis."
            : undefined
        }
        onAdd={add}
        onRemove={remove}
        onReplace={replace}
      />
    </main>
  );
}
