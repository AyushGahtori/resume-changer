import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import ImaginationConnectionCanvas, {
  CONNECTION_DRAG_TYPE,
  MAX_CONNECTION_MESSAGE,
  MAX_CONNECTED_ITEMS,
  buildConnectionPaths,
  dispatchConnectionRequest,
  dispatchConnectionRemoval,
  getConnectionRejection,
  getDistinctConnectedItems,
  parseConnectionDragPayload,
  type ConnectedEvidence,
  type ConnectionRect,
} from "../../../src/components/imagination-connection-canvas";

function evidence(
  index: number,
  kind: "achievement" | "skill" = "achievement",
): ConnectedEvidence {
  return {
    id: `${kind}-${index}`,
    kind,
    label: kind === "skill" ? `Skill ${index}` : `Achievement ${index}`,
  };
}

function renderCanvas(items: readonly ConnectedEvidence[]) {
  return renderToStaticMarkup(
    createElement(ImaginationConnectionCanvas, {
      items,
      onConnect: () => undefined,
      onRemove: () => undefined,
    }),
  );
}

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
): ConnectionRect => ({
  left,
  top,
  width,
  height,
});

describe("ImaginationConnectionCanvas", () => {
  it("renders the empty count and accessible drop guidance", () => {
    const markup = renderCanvas([]);

    expect(markup).toContain("0 / 10 connected");
    expect(markup).toContain('aria-label="Evidence connection canvas"');
    expect(markup).toContain("Drop an achievement or skill here");
    expect(markup).not.toContain("Connect up to 10 items");
    expect(markup).not.toContain("Remove connected");
  });

  it("renders one connected achievement with a keyboard-accessible remove action", () => {
    const markup = renderCanvas([evidence(1)]);

    expect(markup).toContain("1 / 10 connected");
    expect(markup).toContain("Achievement 1");
    expect(markup).toContain(
      'aria-label="Remove connected achievement: Achievement 1"',
    );
  });

  it("renders many connected items in stable identity order", () => {
    const items = [evidence(1), evidence(2, "skill"), evidence(3)];
    const markup = renderCanvas(items);

    expect(markup).toContain("3 / 10 connected");
    expect(markup.indexOf("Achievement 1")).toBeLessThan(
      markup.indexOf("Skill 2"),
    );
    expect(markup.indexOf("Skill 2")).toBeLessThan(
      markup.indexOf("Achievement 3"),
    );
    expect((markup.match(/Remove connected/g) ?? []).length).toBe(3);
  });

  it("shows an announced max-limit message at ten distinct items", () => {
    const items = Array.from({ length: MAX_CONNECTED_ITEMS }, (_, index) =>
      evidence(index),
    );
    const markup = renderCanvas(items);

    expect(markup).toContain("10 / 10 connected");
    expect(markup).toContain(MAX_CONNECTION_MESSAGE);
    expect(markup).toContain('aria-live="polite"');
  });
});

describe("connection selection helpers", () => {
  it("deduplicates the same evidence identity while keeping achievement and skill IDs distinct", () => {
    const achievement = evidence(1);
    const distinct = getDistinctConnectedItems([
      achievement,
      { ...achievement, label: "Duplicate" },
      { ...achievement, kind: "skill", label: "Same ID, separate kind" },
    ]);

    expect(distinct).toHaveLength(2);
    expect(distinct[0].label).toBe("Achievement 1");
  });

  it("rejects duplicates and the eleventh distinct item", () => {
    const items = Array.from({ length: MAX_CONNECTED_ITEMS }, (_, index) =>
      evidence(index),
    );

    expect(getConnectionRejection(items, items[0])).toBe("duplicate");
    expect(getConnectionRejection(items, evidence(11, "skill"))).toBe("limit");
    expect(
      getConnectionRejection(items.slice(0, -1), evidence(11, "skill")),
    ).toBeNull();
  });

  it("emits connect events only for a new item while under the limit", () => {
    const onConnect = vi.fn();
    const existing = [evidence(1)];

    expect(
      dispatchConnectionRequest(existing, evidence(2), onConnect),
    ).toBeNull();
    expect(dispatchConnectionRequest(existing, evidence(1), onConnect)).toBe(
      "duplicate",
    );
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith({
      id: "achievement-2",
      kind: "achievement",
    });

    const atCapacity = Array.from({ length: MAX_CONNECTED_ITEMS }, (_, index) =>
      evidence(index),
    );
    const maxedConnect = vi.fn();
    expect(
      dispatchConnectionRequest(
        atCapacity,
        evidence(11, "skill"),
        maxedConnect,
      ),
    ).toBe("limit");
    expect(maxedConnect).not.toHaveBeenCalled();
  });

  it("parses the evidence drag payload and rejects malformed values", () => {
    expect(CONNECTION_DRAG_TYPE).toBe("application/x-studio-context");
    expect(parseConnectionDragPayload("achievement:point-1")).toEqual({
      id: "point-1",
      kind: "achievement",
    });
    expect(parseConnectionDragPayload("skill:skill-1")).toEqual({
      id: "skill-1",
      kind: "skill",
    });
    for (const malformed of ["", "unknown:id", "skill:", "achievement:a:b"]) {
      expect(parseConnectionDragPayload(malformed)).toBeNull();
    }
  });

  it("dispatches removal with the stable item identity", () => {
    const onRemove = vi.fn();

    dispatchConnectionRemoval(evidence(4, "skill"), onRemove);

    expect(onRemove).toHaveBeenCalledWith({ id: "skill-4", kind: "skill" });
  });
});

describe("connection geometry", () => {
  it("draws no paths for an empty canvas and a root-to-chip path for one item", () => {
    const canvas = rect(10, 20, 600, 180);
    const source = rect(310, 95, 0, 0);

    expect(buildConnectionPaths(canvas, source, [])).toEqual([]);
    expect(
      buildConnectionPaths(canvas, source, [
        { key: "achievement:one", rect: rect(250, 150, 120, 40) },
      ]),
    ).toEqual([
      {
        key: "achievement:one",
        path: "M 300 75 C 300 98.1 300 106.9 300 130",
        endX: 300,
        endY: 130,
      },
    ]);
  });

  it("creates a connector for each chip and recalculates after wrapping or resizing", () => {
    const canvas = rect(0, 0, 700, 240);
    const source = rect(350, 90, 0, 0);
    const before = buildConnectionPaths(canvas, source, [
      { key: "achievement:left", rect: rect(170, 170, 180, 38) },
      { key: "skill:right", rect: rect(360, 170, 120, 38) },
    ]);
    const after = buildConnectionPaths(
      rect(0, 0, 360, 300),
      rect(180, 90, 0, 0),
      [
        { key: "achievement:left", rect: rect(20, 200, 300, 42) },
        { key: "skill:right", rect: rect(80, 250, 180, 38) },
      ],
    );

    expect(before).toHaveLength(2);
    expect(after).toHaveLength(2);
    expect(after[0].path).not.toBe(before[0].path);
    expect(after[1].path).not.toBe(before[1].path);
    expect(after[0].endY).toBe(200);
    expect(after[1].endY).toBe(250);
  });
});

describe("reduced motion", () => {
  it("keeps the particle cue static when reduced motion is requested", () => {
    const styles = readFileSync(
      new URL(
        "../../../src/components/imagination-connection-canvas.module.css",
        import.meta.url,
      ),
      "utf8",
    );

    expect(styles).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(styles).toMatch(/\.particle\s*\{[\s\S]*?animation:\s*none;/);
  });
});
