import { test, expect } from "@playwright/test";

test.describe("Turnplaner & Hallen-Aufbauplaner UI Flow", () => {
  test("Unauthentifizierter Zugriff auf /turnplaner leitet zur Anmeldeseite weiter", async ({ page }) => {
    await page.goto("/turnplaner");
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
