import { test, expect } from "@playwright/test";

test.describe("Authentication UI Flow", () => {
  test("Anmeldeseite laedt mit allen UI-Elementen", async ({ page }) => {
    await page.goto("/login");

    // Marke & Ueberschrift vorhanden
    await expect(page.locator("text=Anmeldung für die Gruppenverwaltung.")).toBeVisible({ timeout: 10000 });

    // Eingabefelder fuer E-Mail und Passwort vorhanden
    const emailInput = page.locator('input[type="email"]');
    const passwordInput = page.locator('input[type="password"]');
    const submitBtn = page.locator('button[type="submit"]');

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
  });

  test("Fehlermeldung bei falschen Anmeldedaten", async ({ page }) => {
    await page.goto("/login");

    const emailInput = page.locator('input[type="email"]');
    await emailInput.waitFor({ state: "visible", timeout: 10000 });
    await emailInput.fill("invalid-user@test.local");
    await page.fill('input[type="password"]', "wrong-password-123");
    await page.click('button[type="submit"]');

    // Erwartet Fehlermeldung auf der Seite
    const errorMessage = page.locator(".text-red-600, .text-red-400");
    await expect(errorMessage).toBeVisible({ timeout: 10000 });
  });

  test("Passwort-vergessen Link navigiert zur Reset-Seite", async ({ page }) => {
    await page.goto("/login");

    const forgotLink = page.locator('text="Passwort vergessen?"');
    await forgotLink.waitFor({ state: "visible", timeout: 10000 });
    await forgotLink.click();
    await expect(page).toHaveURL(/\/passwort-zuruecksetzen/);
  });
});
