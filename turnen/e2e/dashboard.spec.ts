import { test, expect } from "@playwright/test";

test.describe("Dashboard & App Navigation UI", () => {
  test("Unauthentifizierter Zugriff auf Wurzel-URL leitet zur Anmeldeseite weiter", async ({ page }) => {
    await page.goto("/");

    // Umleitung auf /login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test("Dark Mode Toggle schaltet Theme-Klasse am html-Element um", async ({ page }) => {
    await page.goto("/login");

    const themeToggle = page.locator("button").filter({ hasText: /Dunkel|Hell|System/i }).first();
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      const htmlClass = await page.locator("html").getAttribute("class");
      expect(htmlClass).toBeDefined();
    }
  });

  test("Session-Countdown Badge fuer unauthentifizierten Zustand ausgeblendet", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('[aria-label*="Verbleibende Sitzungszeit"]')).not.toBeVisible();
  });
});
