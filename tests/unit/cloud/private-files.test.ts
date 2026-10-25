import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  uid: "alice",
  put: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
  quota: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({
  put: mocks.put,
  get: mocks.get,
  list: mocks.list,
  del: mocks.del,
}));
vi.mock("../../../src/lib/cloud/server-account", () => ({
  requireCloudAccount: async () => ({ uid: mocks.uid }),
}));
vi.mock("../../../src/lib/cloud/usage", () => ({
  consumeAccountUsage: mocks.quota,
}));
import {
  deletePrivatePdfVersions,
  readPrivatePdf,
  savePrivatePdf,
} from "../../../src/lib/cloud/private-files";
const pdf = Buffer.from("%PDF-1.7 fictional test bytes");
const hash = createHash("sha256").update(pdf).digest("hex");
beforeEach(() => {
  mocks.uid = "alice";
  mocks.put.mockResolvedValue({});
  mocks.quota.mockResolvedValue(undefined);
});
afterEach(() => vi.resetAllMocks());
describe("private file account boundaries", () => {
  it("reserves file quota before uploading to a content-addressed private path", async () => {
    expect(await savePrivatePdf("generation-1", pdf)).toBe(hash);
    expect(mocks.put).toHaveBeenCalledWith(
      `accounts/alice/generations/generation-1/${hash}.pdf`,
      pdf,
      expect.objectContaining({ access: "private", addRandomSuffix: false }),
    );
    expect(mocks.quota.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.put.mock.invocationCallOrder[0],
    );
    mocks.quota.mockRejectedValueOnce(new Error("Quota reached"));
    await expect(savePrivatePdf("generation-1", pdf)).rejects.toThrow("Quota");
    expect(mocks.put).toHaveBeenCalledTimes(1);
  });
  it("never derives reads from a caller URL or a different account UID", async () => {
    mocks.uid = "bob";
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Blob([pdf]).stream(),
    });
    expect(await readPrivatePdf("generation-1", hash)).toEqual(pdf);
    expect(mocks.get).toHaveBeenCalledWith(
      `accounts/bob/generations/generation-1/${hash}.pdf`,
      expect.objectContaining({ access: "private" }),
    );
    await expect(readPrivatePdf("../alice", hash)).rejects.toThrow();
  });
  it("rejects oversized, invalid or corrupted bytes", async () => {
    await expect(
      savePrivatePdf("generation-1", Buffer.alloc(2_097_153)),
    ).rejects.toThrow();
    expect(mocks.quota).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue({
      statusCode: 200,
      stream: new Blob(["corrupted"]).stream(),
    });
    await expect(readPrivatePdf("generation-1", hash)).rejects.toThrow(
      "integrity",
    );
  });
  it("cleans all versions only under the signed-in account and preserves failed cleanup for retry", async () => {
    const pathname = `accounts/alice/generations/generation-1/${hash}.pdf`;
    mocks.list.mockResolvedValue({ blobs: [{ pathname }], hasMore: true });
    expect(await deletePrivatePdfVersions("generation-1")).toBe(false);
    expect(mocks.list).toHaveBeenCalledWith(
      expect.objectContaining({
        prefix: "accounts/alice/generations/generation-1/",
        limit: 100,
      }),
    );
    expect(mocks.del).toHaveBeenCalledWith([pathname], expect.anything());
    mocks.list.mockResolvedValue({
      blobs: [{ pathname: pathname.replace("alice", "bob") }],
      hasMore: false,
    });
    await expect(deletePrivatePdfVersions("generation-1")).rejects.toThrow(
      "identity",
    );
    expect(mocks.del).toHaveBeenCalledTimes(1);
    mocks.list.mockResolvedValue({ blobs: [{ pathname }], hasMore: false });
    mocks.del.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(deletePrivatePdfVersions("generation-1")).rejects.toThrow(
      "Unavailable",
    );
  });
});
