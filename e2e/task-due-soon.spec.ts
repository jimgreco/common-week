import { expect, test } from "@playwright/test";

test.use({ timezoneId: "UTC" });

for (const width of [1280, 390, 320]) {
  test(`Due soon keeps seven household dates and task search at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.install({ time: new Date("2026-11-02T00:30:00Z") });
    await page.addInitScript(() => {
      const task = { type: "task", responsibleMemberId: null, isBacklog: true, planningDate: null, weekStartDate: "2026-10-26", isCompleted: false };
      localStorage.setItem("weekofus-task-workspace", JSON.stringify({ tasks: [
        { ...task, id: "due-today", text: "Pack school lunch", deadline: "2026-11-01" },
        { ...task, id: "due-last", text: "Order school books", deadline: "2026-11-07", isBacklog: false, planningDate: "2026-11-10" },
        { ...task, id: "due-later", text: "Buy school shoes", deadline: "2026-11-08" },
        { ...task, id: "due-overdue", text: "Return library books", deadline: "2026-10-31" },
        { ...task, id: "due-undated", text: "Plan school trip", deadline: null },
        { ...task, id: "due-done", text: "Pack school supplies", deadline: "2026-11-01", isCompleted: true },
      ] }));
    });
    await page.goto("/planner?week=2026-10-05&tasks=1");
    const dialog = page.getByRole("dialog", { name: "Household tasks" });
    await dialog.getByRole("button", { name: "Due soon", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Due soon", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", { name: "All", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(dialog.getByText("Open tasks due 2026-11-01 through 2026-11-07 (7 days).")).toBeVisible();
    await expect(dialog.locator(".workspace-task")).toHaveCount(2);
    await expect(dialog.getByRole("button", { name: /Pack school lunch/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Order school books/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`task-due-soon-${width}.png`), animations: "disabled" });
    await dialog.getByRole("searchbox", { name: "Search tasks" }).fill("  LUNCH  ");
    await expect(dialog.locator(".workspace-task")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Clear search" }).click();
    await expect(dialog.getByRole("button", { name: "Due soon", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator(".workspace-task")).toHaveCount(2);
    await dialog.getByRole("button", { name: /Pack school lunch/ }).click();
    await expect(page.getByLabel("Must be done by")).toHaveValue("2026-11-01");
    await page.getByRole("button", { name: "← All tasks" }).click();
    await expect(dialog.getByRole("button", { name: "Due soon", exact: true })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByRole("button", { name: "Overdue", exact: true }).click();
    await expect(dialog.locator(".workspace-task")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: /Return library books/ })).toBeVisible();
  });
}
