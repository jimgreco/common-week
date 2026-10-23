import { expect, test } from "@playwright/test";

for (const width of [1280, 390, 320]) {
  test(`Task sorting preserves filters and reflects edits at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => {
      const task = { type: "task", responsibleMemberId: null, deadline: null, isBacklog: true, planningDate: null, weekStartDate: "2026-10-19", isCompleted: false };
      localStorage.setItem("weekofus-task-workspace", JSON.stringify({ tasks: [
        { ...task, id: "sort-10", text: "Sort review 10", deadline: "2026-10-25" },
        { ...task, id: "sort-2", text: "Sort review 2", isBacklog: false, planningDate: "2026-10-23" },
        { ...task, id: "sort-alpha", text: "Sort review Alpha", isBacklog: false },
      ] }));
    });
    await page.goto("/planner?week=2026-10-19&tasks=1");
    const dialog = page.getByRole("dialog", { name: "Household tasks" });
    const search = dialog.getByRole("searchbox", { name: "Search tasks" });
    await search.fill(" Sort review ");
    const sort = dialog.getByRole("combobox", { name: "Sort tasks" });
    const names = dialog.locator(".workspace-task strong");
    await expect(names).toHaveText(["Sort review 10", "Sort review 2", "Sort review Alpha"]);
    await sort.selectOption("name");
    await sort.selectOption("name");
    await expect(names).toHaveText(["Sort review 2", "Sort review 10", "Sort review Alpha"]);
    await sort.selectOption("planned");
    await expect(names).toHaveText(["Sort review Alpha", "Sort review 2", "Sort review 10"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`task-sorting-${width}.png`), animations: "disabled" });

    await dialog.getByRole("button", { name: "No deadline", exact: true }).click();
    await expect(names).toHaveText(["Sort review Alpha", "Sort review 2"]);
    await dialog.getByRole("button", { name: /Sort review Alpha/ }).click();
    await page.getByLabel("Must be done by").fill("2026-10-20");
    await expect(page.getByLabel("Must be done by")).toHaveValue("2026-10-20");
    await page.getByRole("button", { name: "← All tasks" }).click();
    await expect(sort).toHaveValue("planned");
    await expect(search).toHaveValue(" Sort review ");
    await expect(dialog.getByRole("button", { name: "No deadline", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(names).toHaveText(["Sort review 2"]);
    await dialog.getByRole("button", { name: "All", exact: true }).click();
    await sort.selectOption("deadline");
    await expect(names).toHaveText(["Sort review Alpha", "Sort review 10", "Sort review 2"]);
    await sort.selectOption("default");
    await expect(names).toHaveText(["Sort review 10", "Sort review 2", "Sort review Alpha"]);
    await search.fill("missing");
    await expect(dialog.getByRole("status")).toHaveText("No tasks match your search in this view.");
    await dialog.getByRole("button", { name: "Clear search" }).click();
    await expect(sort).toHaveValue("default");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("weekofus-task-workspace")!).tasks);
    expect(stored.find((task: { id: string }) => task.id === "sort-alpha")).toMatchObject({ deadline: "2026-10-20", planningDate: null, isBacklog: false, isCompleted: false });
    expect(stored.find((task: { id: string }) => task.id === "sort-2")).toMatchObject({ deadline: null, planningDate: "2026-10-23", isBacklog: false });
  });
}
