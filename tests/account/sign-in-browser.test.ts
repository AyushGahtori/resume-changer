import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";
import example from "../../examples/sample-resume-library.json";

describe("Google sign-in and account browser lifecycle", () => {
  it("opens the emulator sign-in, enters an empty private workspace and signs out", async () => {
    if (
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !==
      "demo-resume-changer-security"
    )
      throw new Error("Browser authentication tests require the demo project.");
    const browser = await chromium.launch();
    const context = await browser.newContext();
    // Firebase's emulator widget uses an optional cosmetic CDN script. Keep the
    // authentication test local and wait until its inline click handlers exist.
    await context.route("https://unpkg.com/**", (route) =>
      route.fulfill({
        contentType:
          route.request().resourceType() === "stylesheet"
            ? "text/css"
            : "application/javascript",
        body: "",
      }),
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto("http://127.0.0.1:3017/sign-in");
      const popupPromise = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Continue with Google" }).click();
      const popup = await popupPromise;
      await popup.waitForLoadState("load");
      const addAccount = popup.getByRole("button", { name: /add.*account/i });
      await addAccount.click();
      await popup.locator("#email-input").fill("browser-user@example.test");
      await popup.locator("#display-name-input").fill("Browser Test User");
      await popup.locator("#sign-in").click();
      await page.waitForURL("http://127.0.0.1:3017/", { timeout: 60_000 });
      await page
        .getByRole("button", { name: "Sign out", exact: true })
        .waitFor();
      const privateResponse = await page.request.get(
        "http://127.0.0.1:3017/api/account/library",
      );
      expect(privateResponse.status()).toBe(200);
      expect((await privateResponse.json()).library.jobs).toEqual([]);
      await page.goto("http://127.0.0.1:3017/settings");
      await page.getByLabel("Library or backup file").setInputFiles({
        name: "fictional-library.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(example)),
      });
      await page.getByRole("button", { name: "Import to my account" }).click();
      await page
        .getByRole("status")
        .filter({ hasText: "Your library is imported and verified" })
        .waitFor();
      const imported = await page.request.get(
        "http://127.0.0.1:3017/api/account/library",
      );
      expect((await imported.json()).library).toEqual(example);
      await page.goto("http://127.0.0.1:3017/library");
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.waitForURL("**/sign-in");
      expect(
        (
          await page.request.get("http://127.0.0.1:3017/api/account/library")
        ).status(),
      ).toBe(401);
      expect(errors).toEqual([]);
    } catch (error) {
      await page
        .screenshot({ path: ".runtime/account-browser-failure.png" })
        .catch(() => {});
      throw error;
    } finally {
      await context.close();
      await browser.close();
    }
  }, 120_000);
});
