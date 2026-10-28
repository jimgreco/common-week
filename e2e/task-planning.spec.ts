import { expect, test } from "@playwright/test";

test.use({ timezoneId: "UTC" });

for (const width of [1280, 390, 320]) {
  test(`quick planning keeps deadlines and uses the household day at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.install({ time: new Date("2026-11-02T00:30:00Z") });
    await page.addInitScript(() => {
      if (localStorage.getItem("weekofus-task-workspace")) return;
      localStorage.setItem("weekofus-task-workspace", JSON.stringify({ tasks: [{
        id: "quick-plan", text: "Pack school lunch", type: "task", responsibleMemberId: "demo-rachel",
        deadline: "2026-11-05", isBacklog: true, planningDate: null, weekStartDate: "2026-10-05", isCompleted: false,
      }] }));
    });
    await page.goto("/planner?week=2026-10-05&tasks=1");
    const list = page.getByRole("dialog", { name: "Household tasks" });
    await list.getByRole("button", { name: "Backlog", exact: true }).click();
    await list.getByRole("searchbox", { name: "Search tasks" }).fill(" LUNCH ");
    await list.getByRole("combobox", { name: "Sort tasks" }).selectOption("planned");
    await list.getByRole("button", { name: /Pack school lunch/ }).click();
    await page.getByRole("button", { name: "Plan today", exact: true }).click();
    await expect(page.getByLabel("Plan to do on")).toHaveValue("2026-11-01");
    await expect(page.getByLabel("Must be done by")).toHaveValue("2026-11-05");
    await expect(page.getByLabel("Responsible person")).toHaveValue("demo-rachel");
    await page.getByRole("button", { name: "Plan tomorrow", exact: true }).click();
    await expect(page.getByLabel("Plan to do on")).toHaveValue("2026-11-02");
    await expect(page.getByLabel("Placement")).toHaveValue("day");
    await expect(page.getByLabel("Task complete")).not.toBeChecked();
    await page.getByRole("group", { name: "Quick planning" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`task-planning-${width}.png`), animations: "disabled" });
    await page.getByRole("button", { name: "← All tasks" }).click();
    await expect(list.locator(".workspace-task")).toHaveCount(0);
    await expect(list.getByRole("button", { name: "Backlog", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(list.getByRole("searchbox", { name: "Search tasks" })).toHaveValue(" LUNCH ");
    await expect(list.getByRole("combobox", { name: "Sort tasks" })).toHaveValue("planned");
    await list.getByRole("button", { name: "All", exact: true }).click();
    const task = list.getByRole("button", { name: /Pack school lunch/ });
    await expect(task).toContainText("Rachel · 2026-11-02");
    await expect(task).toContainText("Due 2026-11-05");
    await page.reload();
    await list.getByRole("button", { name: /Pack school lunch/ }).click();
    await expect(page.getByLabel("Plan to do on")).toHaveValue("2026-11-02");
    await expect(page.getByLabel("Must be done by")).toHaveValue("2026-11-05");
    await expect(page.getByLabel("Responsible person")).toHaveValue("demo-rachel");
  });
}
