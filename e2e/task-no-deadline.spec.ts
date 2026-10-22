import { expect, test } from "@playwright/test";

for (const width of [1280, 390, 320]) {
  test(`No deadline composes search and reflects saved edits at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      const task = { type: "task", responsibleMemberId: null, deadline: null, isBacklog: true, planningDate: null, weekStartDate: "2026-10-19", isCompleted: false };
      localStorage.setItem("weekofus-task-workspace", JSON.stringify({ tasks: [
        { ...task, id: "review-backlog", text: "Review school supplies" },
        { ...task, id: "review-day", text: "Review trip plans", isBacklog: false, planningDate: "2026-10-22" },
        { ...task, id: "review-week", text: "Review camp checklist", isBacklog: false },
        { ...task, id: "review-dated", text: "Review dated task", deadline: "2026-10-23" },
        { ...task, id: "review-done", text: "Review completed task", isCompleted: true },
      ] }));
    });
    await page.goto("/planner?week=2026-10-19&tasks=1");
    const dialog = page.getByRole("dialog", { name: "Household tasks" });
    const choose = async (name: string) => dialog.getByRole("button", { name, exact: true }).click();
    await choose("No deadline");
    await expect(dialog.getByText("Open tasks without a deadline, whether planned or in the backlog.")).toBeVisible();
    const search = dialog.getByRole("searchbox", { name: "Search tasks" });
    await search.fill("  REVIEW  ");
    await expect(dialog.locator(".workspace-task")).toHaveCount(3);
    await expect(dialog.getByRole("button", { name: /Review trip plans/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Review camp checklist/ })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "No deadline", exact: true })).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`task-no-deadline-${width}.png`), animations: "disabled" });

    await search.fill("missing");
    await expect(dialog.getByRole("status")).toHaveText("No tasks match your search in this view.");
    await dialog.getByRole("button", { name: "Clear search" }).click();
    await expect(dialog.getByRole("button", { name: "No deadline", exact: true })).toHaveAttribute("aria-pressed", "true");
    await search.fill("Review school supplies");
    const task = dialog.getByRole("button", { name: /Review school supplies/ });
    await task.click();
    await page.getByRole("button", { name: "Set deadline to tomorrow" }).click();
    await expect(page.getByLabel("Must be done by")).not.toHaveValue("");
    await page.getByRole("button", { name: "← All tasks" }).click();
    await expect(task).not.toBeVisible();
    await choose("All");
    await task.click();
    await page.getByLabel("Must be done by").fill("");
    await expect(page.getByLabel("Must be done by")).toHaveValue("");
    await page.getByRole("button", { name: "← All tasks" }).click();
    await choose("No deadline");
    await expect(task).toBeVisible();
    await task.click();
    await page.getByLabel("Task complete").check();
    await expect(page.getByLabel("Task complete")).toBeChecked();
    await page.getByRole("button", { name: "← All tasks" }).click();
    await expect(task).not.toBeVisible();
    await choose("Completed");
    await task.click();
    await page.getByLabel("Task complete").uncheck();
    await page.getByRole("button", { name: "← All tasks" }).click();
    await choose("No deadline");
    await expect(task).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("weekofus-task-workspace")!).tasks.find((t: { id: string }) => t.id === "review-backlog"));
    expect(saved).toMatchObject({ deadline: null, isCompleted: false, isBacklog: true, planningDate: null });
  });
}
