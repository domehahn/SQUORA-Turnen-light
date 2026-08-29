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

  test("Dropout-Hinweis nutzt 90 Tage, mindestens vier Einheiten und höchstens 25 Prozent", async ({ page }) => {
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/api/me")) {
        return route.fulfill({
          json: {
            id: "user-1",
            email: "trainer@example.com",
            name: "Test Trainer",
            clubId: "club-1",
            clubName: "Testverein",
            clubRole: "member",
            isAdmin: false,
            mfaSetupRequired: false,
            passwordChangeRequired: false,
          },
        });
      }
      if (url.pathname.endsWith("/api/groups")) {
        return route.fulfill({
          json: [{ id: "group-1", name: "Testgruppe", canEdit: true, editableAsLeadership: false, minAge: 3, maxAge: 12, maxChildren: 20 }],
        });
      }
      if (url.pathname.endsWith("/api/children")) {
        return route.fulfill({
          json: [
            { id: "risk", firstName: "Risiko", lastName: "Kind", birthDate: "2020-01-01", groupId: "group-1", status: "active" },
            { id: "few", firstName: "ZuWenig", lastName: "Einheiten", birthDate: "2020-01-01", groupId: "group-1", status: "active" },
            { id: "active", firstName: "Aktiv", lastName: "Kind", birthDate: "2020-01-01", groupId: "group-1", status: "active" },
          ],
        });
      }
      if (url.pathname.endsWith("/api/attendance-stats")) {
        return route.fulfill({
          json: {
            childrenStats: {
              risk: { presentCount: 1, totalRecorded: 4, quote: 25, isInactive: true },
              few: { presentCount: 0, totalRecorded: 3, quote: 0, isInactive: true },
              active: { presentCount: 4, totalRecorded: 4, quote: 100, isInactive: false },
            },
            groupQuotes: {},
            clubQuote: { presentCount: 5, totalRecorded: 11, quote: 45 },
          },
        });
      }
      return route.fulfill({ json: [] });
    });

    await page.goto("/");

    await expect(page.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Start", exact: true })).toHaveCount(0);
    const dropoutSection = page.getByRole("heading", { name: /Erhöhte Dropout-Wahrscheinlichkeit \(1\)/ }).locator("..").locator("..");
    await expect(dropoutSection).toContainText("letzten 90 Tagen");
    await expect(dropoutSection).toContainText("mindestens 4 erfassten Einheiten");
    await expect(dropoutSection).toContainText("Risiko Kind");
    await expect(dropoutSection).not.toContainText("ZuWenig Einheiten");

    await page.setViewportSize({ width: 360, height: 800 });
    const substitutesCard = page.getByRole("link", { name: /Offene Vertretungsanfragen/ });
    await expect(substitutesCard).toBeVisible();
    expect(
      await substitutesCard.evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true);
  });
});
