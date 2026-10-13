import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`task search and clear work within the backlog at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/planner?tasks=1");
    const dialog = page.getByRole("dialog", { name: "Household tasks" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Capture a task").fill("Searchable camp checklist");
    await dialog.getByRole("button", { name: "Add to backlog" }).click();
    const task = dialog.getByRole("button", { name: /Searchable camp checklist/ });
    await expect(task).toBeVisible();
    const search = dialog.getByRole("searchbox", { name: "Search tasks" });
    await search.fill("  CAMP  ");
    await expect(task).toBeVisible();
    await search.fill("missing");
    await expect(task).toHaveCount(0);
    await expect(dialog.getByRole("status")).toHaveText("No tasks match your search in this view.");
    await dialog.getByRole("button", { name: "Clear search" }).click();
    await expect(task).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Backlog", exact: true })).toHaveAttribute("aria-pressed", "true");
    await search.fill("CAMP");
    await page.screenshot({ path: testInfo.outputPath(`task-search-${width}.png`) });
    await task.click();
    await expect(page.getByRole("button", { name: "I’ll take this" })).toBeVisible();
  });
}
