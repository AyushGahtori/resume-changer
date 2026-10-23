"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { ArrowUp, FileText, Move, Sparkles, Wrench, X } from "lucide-react";
import styles from "./imagination-connection-canvas.module.css";

export const MAX_CONNECTED_ITEMS = 10;
export const CONNECTION_DRAG_TYPE = "application/x-studio-context";
export const MAX_CONNECTION_MESSAGE =
  "Ten context items are connected. Remove one before adding another.";

export type ConnectionKind = "achievement" | "skill";

export type ConnectionIdentity = {
  id: string;
  kind: ConnectionKind;
};

export type ConnectedEvidence = ConnectionIdentity & {
  label: string;
};

export type ConnectionRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ConnectionLine = {
  key: string;
  path: string;
  endX: number;
  endY: number;
};

type Props = {
  items: readonly ConnectedEvidence[];
  onConnect: (item: ConnectionIdentity) => void;
  onRemove: (item: ConnectionIdentity) => void;
};

function connectionKey(item: ConnectionIdentity) {
  return `${item.kind}:${item.id}`;
}

export function getDistinctConnectedItems(
  items: readonly ConnectedEvidence[],
): ConnectedEvidence[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = connectionKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseConnectionDragPayload(
  value: string,
): ConnectionIdentity | null {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;

  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1).trim();
  if ((kind !== "achievement" && kind !== "skill") || !id || id.includes(":"))
    return null;

  return { id, kind };
}

export function getConnectionRejection(
  items: readonly ConnectedEvidence[],
  candidate: ConnectionIdentity,
): "duplicate" | "limit" | null {
  const distinctItems = getDistinctConnectedItems(items);
  if (
    distinctItems.some(
      (item) => connectionKey(item) === connectionKey(candidate),
    )
  )
    return "duplicate";
  if (distinctItems.length >= MAX_CONNECTED_ITEMS) return "limit";
  return null;
}

export function dispatchConnectionRequest(
  items: readonly ConnectedEvidence[],
  candidate: ConnectionIdentity,
  onConnect: (item: ConnectionIdentity) => void,
) {
  const rejection = getConnectionRejection(items, candidate);
  if (!rejection) onConnect({ id: candidate.id, kind: candidate.kind });
  return rejection;
}

export function dispatchConnectionRemoval(
  item: ConnectionIdentity,
  onRemove: (item: ConnectionIdentity) => void,
) {
  onRemove({ id: item.id, kind: item.kind });
}

function formatCoordinate(value: number) {
  return Number(value.toFixed(2)).toString();
}

export function buildConnectionPaths(
  canvas: ConnectionRect,
  source: ConnectionRect,
  targets: readonly { key: string; rect: ConnectionRect }[],
): ConnectionLine[] {
  const startX = source.left - canvas.left + source.width / 2;
  const startY = source.top - canvas.top + source.height;

  return targets.map(({ key, rect }) => {
    const endX = rect.left - canvas.left + rect.width / 2;
    const endY = rect.top - canvas.top;
    const bend = Math.max(14, Math.abs(endY - startY) * 0.42);
    const path = [
      `M ${formatCoordinate(startX)} ${formatCoordinate(startY)}`,
      `C ${formatCoordinate(startX)} ${formatCoordinate(startY + bend)}`,
      `${formatCoordinate(endX)} ${formatCoordinate(endY - bend)}`,
      `${formatCoordinate(endX)} ${formatCoordinate(endY)}`,
    ].join(" ");

    return { key, path, endX, endY };
  });
}

function geometryIsEqual(
  left: { width: number; height: number; lines: ConnectionLine[] },
  right: { width: number; height: number; lines: ConnectionLine[] },
) {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.lines.length === right.lines.length &&
    left.lines.every(
      (line, index) =>
        line.key === right.lines[index]?.key &&
        line.path === right.lines[index]?.path,
    )
  );
}

export default function ImaginationConnectionCanvas({
  items,
  onConnect,
  onRemove,
}: Props) {
  const uniqueItems = useMemo(() => getDistinctConnectedItems(items), [items]);
  const canvasRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const itemElementsRef = useRef(new Map<string, HTMLDivElement>());
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const helperId = useId();
  const [feedback, setFeedback] = useState("");
  const [geometry, setGeometry] = useState({
    width: 0,
    height: 0,
    lines: [] as ConnectionLine[],
  });

  const showTransientFeedback = useCallback((msg: string) => {
    setFeedback(msg);
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback("");
    }, 2200);
  }, []);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  const measureConnections = useCallback(() => {
    const stage = stageRef.current;
    const root = sourceRef.current;
    if (!stage || !root) return;

    const canvasRect = stage.getBoundingClientRect();
    const sourceRect = root.getBoundingClientRect();
    const targets = uniqueItems.flatMap((item) => {
      const element = itemElementsRef.current.get(connectionKey(item));
      return element
        ? [{ key: connectionKey(item), rect: element.getBoundingClientRect() }]
        : [];
    });
    const next = {
      width: Math.max(1, stage.clientWidth || canvasRect.width),
      height: Math.max(1, stage.scrollHeight || canvasRect.height),
      lines: buildConnectionPaths(canvasRect, sourceRect, targets),
    };

    setGeometry((current) => (geometryIsEqual(current, next) ? current : next));
  }, [uniqueItems]);

  useEffect(() => {
    const stage = stageRef.current;
    const root = rootRef.current;
    const source = sourceRef.current;
    const itemsContainer = itemsRef.current;
    if (!stage || !root || !source || !itemsContainer) return;

    measureConnections();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measureConnections);
    if (resizeObserver) {
      resizeObserver.observe(stage);
      resizeObserver.observe(root);
      resizeObserver.observe(source);
      resizeObserver.observe(itemsContainer);
      for (const item of uniqueItems) {
        const element = itemElementsRef.current.get(connectionKey(item));
        if (element) resizeObserver.observe(element);
      }
    }
    window.addEventListener("resize", measureConnections);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measureConnections);
    };
  }, [measureConnections, uniqueItems]);

  function handleConnect(candidate: ConnectionIdentity) {
    const rejection = dispatchConnectionRequest(
      uniqueItems,
      candidate,
      onConnect,
    );
    if (rejection === "duplicate") {
      showTransientFeedback("That item is already connected.");
      return;
    }
    if (rejection === "limit") {
      showTransientFeedback(MAX_CONNECTION_MESSAGE);
      return;
    }

    const item = uniqueItems.find(
      (connected) => connectionKey(connected) === connectionKey(candidate),
    );
    showTransientFeedback(
      item ? `Connected ${item.label}.` : "Connected selected evidence.",
    );
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    if (Array.from(event.dataTransfer.types).includes(CONNECTION_DRAG_TYPE)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const candidate = parseConnectionDragPayload(
      event.dataTransfer.getData(CONNECTION_DRAG_TYPE),
    );
    if (!candidate) {
      showTransientFeedback(
        "Choose an achievement or skill from the evidence libraries.",
      );
      return;
    }
    handleConnect(candidate);
  }

  function handleRemove(item: ConnectedEvidence) {
    dispatchConnectionRemoval(item, onRemove);
    showTransientFeedback(`Removed ${item.label} from connected evidence.`);
    canvasRef.current?.focus();
  }

  const count = uniqueItems.length;
  const limitMessage =
    count >= MAX_CONNECTED_ITEMS ? MAX_CONNECTION_MESSAGE : "";
  const statusMessage = feedback || limitMessage;

  return (
    <section
      ref={canvasRef}
      className={styles.canvas}
      tabIndex={-1}
      aria-label="Evidence connection canvas"
      aria-describedby={helperId}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className={styles.stage} ref={stageRef}>
        {count > 0 && (
          <span
            className="imagination-canvas-motion"
            data-active="true"
            aria-hidden="true"
            key={uniqueItems.map(connectionKey).join(",")}
          >
            <ArrowUp className="imagination-canvas-motion__arrow" size={15} />
            <ArrowUp className="imagination-canvas-motion__arrow" size={15} />
            <ArrowUp className="imagination-canvas-motion__arrow" size={15} />
            <ArrowUp className="imagination-canvas-motion__arrow" size={15} />
          </span>
        )}
        <div className={styles.dragHint}>
          <Move size={20} aria-hidden="true" />
          <p>
            <strong>Hold and drag</strong> an achievement or skill to connect it
            to your draft.
          </p>
        </div>
        <div className={styles.root} ref={rootRef}>
          <div className={styles.sparkle} aria-hidden="true">
            <Sparkles size={20} />
          </div>
          <span
            className={styles.count}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {count} / {MAX_CONNECTED_ITEMS} connected
          </span>
          <p className={styles.helper} id={helperId}>
            Hold and drag to connect evidence or skills
          </p>
        </div>

        <div
          className={styles.sourceAnchor}
          ref={sourceRef}
          aria-hidden="true"
        />

        {geometry.lines.length > 0 &&
          geometry.width > 0 &&
          geometry.height > 0 && (
            <svg
              className={styles.connections}
              aria-hidden="true"
              focusable="false"
              viewBox={`0 0 ${geometry.width} ${geometry.height}`}
              preserveAspectRatio="none"
            >
              {geometry.lines.map((line) => (
                <g key={line.key}>
                  <path className={styles.connectionPath} d={line.path} />
                  <circle
                    className={styles.connectionEnd}
                    cx={line.endX}
                    cy={line.endY}
                    r="3"
                  />
                </g>
              ))}
            </svg>
          )}

        <div className={styles.items} ref={itemsRef}>
          {uniqueItems.map((item) => {
            const Icon = item.kind === "achievement" ? FileText : Wrench;
            return (
              <div
                className={styles.chip}
                key={connectionKey(item)}
                ref={(element) => {
                  const key = connectionKey(item);
                  if (element) itemElementsRef.current.set(key, element);
                  else itemElementsRef.current.delete(key);
                }}
              >
                <Icon
                  className={styles.chipIcon}
                  size={16}
                  aria-hidden="true"
                />
                <span className={styles.chipLabel} title={item.label}>
                  {item.label}
                </span>
                <button
                  className={styles.remove}
                  type="button"
                  aria-label={`Remove connected ${item.kind}: ${item.label}`}
                  onClick={() => handleRemove(item)}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
            );
          })}
          {count === 0 && (
            <p className={styles.empty}>
              Drop an achievement or skill here to connect it to your draft.
            </p>
          )}
        </div>
      </div>
      <p
        className={styles.status}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </p>
    </section>
  );
}
