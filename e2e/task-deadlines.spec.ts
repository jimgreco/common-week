import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`quick deadlines save without scheduling a backlog task at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.clock.install({ time: new Date("2026-11-01T04:30:00Z") });
    await page.goto("/planner?tasks=1");
    const tasks = page.getByRole("dialog", { name: "Household tasks" });
    await tasks.getByLabel("Capture a task").fill("Quick deadline checklist");
    await tasks.getByRole("button", { name: "Add to backlog" }).click();
    const task = tasks.getByRole("button", { name: /Quick deadline checklist/ });
    await task.click();
    await page.getByRole("button", { name: "Set deadline to today" }).click();
    await expect(page.getByLabel("Must be done by")).toHaveValue("2026-11-01");
    await page.getByRole("button", { name: "Set deadline to tomorrow" }).click();
    await expect(page.getByLabel("Must be done by")).toHaveValue("2026-11-02");
    await page.screenshot({ path: testInfo.outputPath(`task-deadlines-${width}.png`) });
    await page.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(task).toContainText("Due 2026-11-02");
    await task.click();
    await expect(page.getByLabel("Must be done by")).toHaveValue("2026-11-02");
  });
}
