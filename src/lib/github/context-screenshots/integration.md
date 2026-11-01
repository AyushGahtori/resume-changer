# Task 03 integration notes

## Acceptance record

- Task: optional screenshots and bounded multimodal boundary.
- Source checkout: `C:/Users/Ayush/Documents/ChatGPT/re_changer`.
- Plan base: `bdaf1380ba99f6d7a80040574e0d788ff3b22d17` (the context redesign plan commit; parent `8a3be18e2e6b346146ea3bea3c811ec1667755c5`).
- Task branch: `codex/github-context-task-03-screenshots`.
- Task workspace: `C:/Users/Ayush/.codex/worktrees/github-context-task-03-screenshots/re_changer`.
- Owned implementation: `src/components/github-import/context-screenshots/**` and `src/lib/github/context-screenshots/**`; tests and the isolated E2E harness are under the matching `tests/` and `src/app/e2e/` paths.

## UI and memory lifecycle

Mount `ContextScreenshots` below the interview's purpose/notes controls. Keep its `images` value in the owning page's memory only. On add, remove, replace, or discard, call the consent invalidation callback and rebuild the enclosing exact-evidence consent using `createScreenshotConsentHash`. The inputs are the prepared source hash, structured project-context hash, exact notes string, and screenshot identities in display order. A text/context/screenshot change must clear any previous approval.

The image component processes one input at a time. It uses a short-lived module worker with `OffscreenCanvas` when available and falls back to a bounded main-thread canvas path. Both paths decode, draw and re-encode; the encoded result therefore drops the original metadata. The input `File` is not retained after processing. Only the processed `Blob` remains in page memory. Preview object URLs are revoked when the list changes or the component unmounts; its controller is aborted on unmount. The enclosing import must clear its in-memory image list on discard/session destruction and must never put image bytes in sessionStorage, localStorage, IndexedDB, Firestore, the encrypted checkpoint capsule, or saved achievement provenance.

## Request wire format and admission

Use one JSON request for final, explicitly approved analysis:

```json
{
  "version": "context-screenshots-v1",
  "capsule": "<existing encrypted text/context capsule; no image bytes>",
  "consentHash": "<hash over source, interview context, notes, and image identities>",
  "screenshots": [
    {
      "id": "<tab-local id>",
      "mediaType": "image/webp",
      "width": 1280,
      "height": 720,
      "byteLength": 173410,
      "sha256": "<lowercase sha-256 of processed bytes>",
      "dataBase64": "<base64 of processed bytes>"
    }
  ]
}
```

The base64 attachments are top-level request fields, never part of the encrypted capsule. `buildScreenshotRequest` re-hashes the processed blobs, recomputes consent, serializes the exact envelope, measures UTF-8 bytes (including base64 expansion and JSON overhead), and refuses requests above the existing 4,100,000-byte request cap or a capsule above 3,800,000 characters. It also enforces five images, 200 KiB/image and 750 KiB total. It does not truncate the capsule or images.

The route must read the request through its bounded streaming body reader **before** JSON parsing, reject actual bodies above 4,100,000 bytes, and decode UTF-8 in fatal mode. It must decrypt and validate the capsule, derive `expectedCapsule`, `expectedConsentHash`, and the full expected consent input server-side, then call `validateScreenshotRequest` with the measured wire byte count and a fully decoding server image codec. The helper checks body-byte agreement, capsule/consent equality, base64, actual byte/hash/type/dimensions, animation and aggregate limits. Authorization, origin/session checks, active-run cancellation and consent checks remain the route's responsibility and happen before provider dispatch.

The base plan has no directly declared server image decoder. This task adds a required structural `ServerImageDecoder` port and fails closed with `unavailable` if it is not configured. Final assembly must choose and directly declare a maintained server codec, then implement the port so it fully decodes JPEG/PNG/WebP and rejects malformed streams/animation. Header parsing alone is not a substitute for full decode. Do not add a transitive dependency import or silently accept screenshots when the decoder is absent.

## Provider boundary

Only after approval and server validation, pass a `ValidatedScreenshotRequest` to `createMultimodalScreenshotAdapter`. Its structural model port receives the prompt, exact validated byte arrays, media types, hashes and the original abort signal. The configured model capability must be explicitly verified and supplied as `supportsImages`; with screenshots present and a false capability the adapter returns `unsupported-image` without calling the model. It never chooses a fallback model. A text-only rerun requires a newly approved envelope with no screenshot identities.

For Gemini assembly, map prompt and images to one GenerateContent request with text parts and `inlineData` parts using only validated MIME/data. Keep the existing text-only `AiProvider` methods and defaults unchanged while adding the eventual shared multimodal method. Confirm the selected configured model's image support from current provider configuration/docs, preserve the existing request timeout and abort signal, and map image-token usage only when the provider actually returns it. `null` means unknown; compressed byte size is not an image-token estimate.

The validated byte arrays are transient request data: do not checkpoint them, cache them, log them, or include them in error details. Tests use an in-memory capture provider and synthetic images, with all network/provider paths disabled.

## Shared assembly changes intentionally left out of this task

- Add the screenshot identities and consent hash to the versioned interview/session DTO without adding image bytes to that DTO.
- Add the final multimodal request route/client call and enforce the actual stream-body cap.
- Bind a production image decoder and image-capable provider model; keep the test harness unavailable in hosted deployments.
- Add UI composition below the notes field and make the Analyze action show/approve the exact current image previews/hashes.
