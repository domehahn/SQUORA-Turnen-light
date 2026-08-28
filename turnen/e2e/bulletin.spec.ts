import { test, expect } from "@playwright/test";

test.describe("Schwarzes Brett & Pinnwand UI Flow", () => {
  test("Unauthentifizierter Zugriff auf /pinnwand leitet zur Anmeldeseite weiter", async ({ page }) => {
    await page.goto("/pinnwand");
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
