import { test, expect } from "@playwright/test";

test.describe("Turnplaner & Hallen-Aufbauplaner UI Flow", () => {
  test("Unauthentifizierter Zugriff auf /turnplaner leitet zur Anmeldeseite weiter", async ({ page }) => {
    await page.goto("/turnplaner");
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
  });

  test("Geräte lassen sich mit der Maus auf der Hallenfläche verschieben", async ({ page }) => {
    await page.route("**/api/me", (route) =>
      route.fulfill({
        json: {
          id: "user-1",
          email: "trainer@example.com",
          name: "Test Trainer",
          clubId: "club-1",
          clubName: "Testverein",
          clubRole: "trainer",
          isAdmin: false,
          mfaSetupRequired: false,
          passwordChangeRequired: false,
        },
      })
    );
    await page.route("**/api/training-plans", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/groups", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/holidays/custom", (route) => route.fulfill({ json: [] }));
    await page.route("**/api/notifications**", (route) => route.fulfill({ json: [] }));

    await page.goto("/turnplaner");
    await expect(page.getByTestId("turnplaner-hall-floor")).toBeVisible();

    for (const category of [
      { name: "🟦 Matten & AirTrack", iconCount: 5 },
      { name: "🤸‍♂️ Großgeräte", iconCount: 9 },
      { name: "🚀 Sprunggeräte", iconCount: 4 },
      { name: "🧱 Kästen, Bänke & Tau", iconCount: 6 },
      { name: "⚽ Kleingeräte & Parcours", iconCount: 7 },
    ]) {
      await page.getByRole("button", { name: category.name }).click();
      const templates = page.locator('[data-testid^="turnplaner-template-"]');
      await expect(templates).toHaveCount(category.iconCount);
      await expect(templates.locator("svg")).toHaveCount(category.iconCount);
    }

    await page.getByRole("button", { name: "+ Neuer Hallenaufbau" }).click();

    const equipment = page.locator('[data-testid^="turnplaner-equipment-"]').first();
    const equipmentIcon = equipment.getByTestId("turnplaner-equipment-icon");
    const equipmentLabel = equipment.getByTestId("turnplaner-equipment-label");
    await expect(equipmentIcon).toBeVisible();
    await expect(equipmentIcon.locator("svg")).toBeVisible();
    await expect(equipment).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(equipment).toHaveCSS("border-top-width", "0px");
    await equipment.click();
    await expect(equipmentIcon).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(equipmentIcon).toHaveCSS("border-top-width", "0px");
    await expect(equipmentLabel).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(equipmentLabel).toHaveCSS("border-top-width", "0px");
    const originalLeft = await equipment.evaluate((element) => (element as HTMLElement).style.left);
    const originalTop = await equipment.evaluate((element) => (element as HTMLElement).style.top);
    const box = await equipment.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + box!.height / 2 + 60, { steps: 5 });
    await page.mouse.up();

    await expect.poll(() => equipment.evaluate((element) => (element as HTMLElement).style.left)).not.toBe(originalLeft);
    await expect.poll(() => equipment.evaluate((element) => (element as HTMLElement).style.top)).not.toBe(originalTop);
  });
});
