import { test, expect } from "@playwright/test";

test.describe("Geräte- & Mängelmelder UI Flow", () => {
  test("Unauthentifizierter Zugriff auf /geraete leitet zur Anmeldeseite weiter", async ({ page }) => {
    await page.goto("/geraete");
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });
});
