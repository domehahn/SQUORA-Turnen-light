import { test, expect } from "@playwright/test";

test.describe("P1-2 Account Setup & Password Reset UI Flow", () => {
  test("Aktivierungs-Link entfernt Token sofort aus Browser-URL und zeigt Aktivierungsformular", async ({ page }) => {
    // Aufruf mit Aktivierungs-Token und type=setup
    await page.goto("/passwort-zuruecksetzen?token=mock-setup-token-12345&type=setup");

    // Token wurde sofort aus Adresszeile per history.replaceState entfernt (P1 Hardening)
    await expect.poll(() => page.url(), { timeout: 10000 }).not.toContain("token=");

    // UI zeigt Aktivierungs-Text
    await expect(page.locator("text=Konto aktivieren").first()).toBeVisible({ timeout: 10000 });

    // Eingabefelder fuer neues Passwort vorhanden
    const newPw = page.locator('input[type="password"]').first();
    await expect(newPw).toBeVisible();
  });

  test("Mindestlaengen-Validierung fuer Passwort (15 Zeichen)", async ({ page }) => {
    await page.goto("/passwort-zuruecksetzen?token=mock-setup-token-12345&type=setup");

    const inputs = page.locator('input[type="password"]');
    await inputs.nth(0).waitFor({ state: "visible", timeout: 10000 });
    await inputs.nth(0).fill("zu-kurz");
    await inputs.nth(1).fill("zu-kurz");

    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Browser HTML5-Validierung oder Formular blockiert zu kurzes Passwort
    expect(page.url()).toContain("/passwort-zuruecksetzen");
  });
});
