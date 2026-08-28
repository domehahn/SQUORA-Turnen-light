import { test, expect } from "@playwright/test";

test.describe("Events & Helfer-Zuteilung UI Flow", () => {
  test("Unauthentifizierter Zugriff auf /events leitet zur Anmeldeseite weiter", async ({ page }) => {
    await page.goto("/events");
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
