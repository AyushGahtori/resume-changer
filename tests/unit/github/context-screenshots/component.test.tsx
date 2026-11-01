// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ProcessedScreenshot,
  type ScreenshotResult,
} from "../../../../src/lib/github/context-screenshots/contracts";
import { ContextScreenshots } from "../../../../src/components/github-import/context-screenshots/context-screenshots";

function fixture(file: File): ScreenshotResult<ProcessedScreenshot> {
  return {
    ok: true,
    value: {
      id: `id-${file.name}`,
      fileName: file.name,
      mediaType: "image/webp",
      width: 640,
      height: 360,
      byteLength: 12,
      sha256: "a".repeat(64),
      blob: new Blob([new Uint8Array(12)], { type: "image/webp" }),
    },
  };
}

describe("ContextScreenshots", () => {
  let host: HTMLDivElement;
  let root: Root;
  let urlNumber: number;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  const fetchSpy = vi.fn();

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    urlNumber = 0;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => `blob:fixture-${++urlNumber}`);
    URL.revokeObjectURL = vi.fn();
    fetchSpy.mockReset();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.unstubAllGlobals();
  });

  function setFileInput(files: File[]) {
    const input = host.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("Screenshot file input was not rendered.");
    Object.defineProperty(input, "files", { configurable: true, value: files });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  it("processes in page memory, invalidates consent, previews, removes, and revokes URLs", async () => {
    const onChange = vi.fn<(images: ProcessedScreenshot[]) => void>();
    const onConsentInvalidated = vi.fn();
    const processor = vi.fn(async (file: File) => fixture(file));
    await act(async () => {
      root.render(
        <ContextScreenshots
          images={[]}
          onChange={onChange}
          onConsentInvalidated={onConsentInvalidated}
          processor={processor}
        />,
      );
    });

    await act(async () => {
      setFileInput([new File(["fictional dashboard"], "dashboard.png", { type: "image/png" })]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(processor).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].fileName).toBe("dashboard.png");
    expect(onConsentInvalidated).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("sent only with your approved analysis");
    expect(fetchSpy).not.toHaveBeenCalled();

    const images = onChange.mock.calls[0][0];
    await act(async () => {
      root.render(
        <ContextScreenshots
          images={images}
          onChange={onChange}
          onConsentInvalidated={onConsentInvalidated}
          processor={processor}
        />,
      );
    });
    const review = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Review preview"),
    );
    expect(review).toBeDefined();
    await act(async () => review?.click());
    expect(host.querySelector('img[alt="Larger preview of dashboard.png"]')).not.toBeNull();

    const remove = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove dashboard.png"]',
    );
    expect(remove).not.toBeNull();
    await act(async () => remove?.click());
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual([]);
    expect(onConsentInvalidated).toHaveBeenCalledTimes(2);
    await act(async () => {
      root.render(
        <ContextScreenshots
          images={[]}
          onChange={onChange}
          onConsentInvalidated={onConsentInvalidated}
          processor={processor}
        />,
      );
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture-1");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("processes a multi-file drop sequentially and rejects files beyond five", async () => {
    let active = 0;
    let maxActive = 0;
    const processor = vi.fn(async (file: File) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return fixture(file);
    });
    const onChange = vi.fn<(images: ProcessedScreenshot[]) => void>();
    await act(async () => {
      root.render(
        <ContextScreenshots images={[]} onChange={onChange} processor={processor} />,
      );
    });
    const files = Array.from(
      { length: 6 },
      (_, index) => new File([`image-${index}`], `screen-${index}.png`, { type: "image/png" }),
    );
    await act(async () => {
      setFileInput(files);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(processor).toHaveBeenCalledTimes(5);
    expect(maxActive).toBe(1);
    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(5);
    expect(host.textContent).toContain("Only five screenshots can be included");
  });

  it("replaces an image as a new consent revision and revokes the old preview URL", async () => {
    const original = fixture(new File(["old"], "old.png"));
    if (!original.ok) throw new Error(original.error.message);
    const onChange = vi.fn<(images: ProcessedScreenshot[]) => void>();
    const onConsentInvalidated = vi.fn();
    const processor = vi.fn(async (file: File) => fixture(file));
    await act(async () => {
      root.render(
        <ContextScreenshots
          images={[original.value]}
          onChange={onChange}
          onConsentInvalidated={onConsentInvalidated}
          processor={processor}
        />,
      );
    });
    const replace = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Replace"),
    );
    await act(async () => replace?.click());
    await act(async () => {
      setFileInput([new File(["new"], "replacement.png", { type: "image/png" })]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onChange.mock.calls.at(-1)?.[0]).toHaveLength(1);
    expect(onChange.mock.calls.at(-1)?.[0][0].fileName).toBe("replacement.png");
    expect(onConsentInvalidated).toHaveBeenCalledTimes(1);
    await act(async () => {
      root.render(
        <ContextScreenshots
          images={onChange.mock.calls.at(-1)![0]}
          onChange={onChange}
          onConsentInvalidated={onConsentInvalidated}
          processor={processor}
        />,
      );
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fixture-1");
  });

  it("cancels in-flight processing without changing the approved image list", async () => {
    const onChange = vi.fn<(images: ProcessedScreenshot[]) => void>();
    const processor = vi.fn(
      (_file: File, signal: AbortSignal) =>
        new Promise<ScreenshotResult<ProcessedScreenshot>>((resolve) => {
          signal.addEventListener(
            "abort",
            () =>
              resolve({
                ok: false,
                error: { code: "cancelled", message: "Cancelled." },
              }),
            { once: true },
          );
        }),
    );
    await act(async () => {
      root.render(<ContextScreenshots images={[]} onChange={onChange} processor={processor} />);
    });
    await act(async () => {
      setFileInput([new File(["new"], "cancel-me.png", { type: "image/png" })]);
    });
    const cancel = [...host.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Cancel"),
    );
    expect(cancel).toBeDefined();
    await act(async () => {
      cancel?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Screenshot processing was cancelled.");
  });
});
