import { expect, test, type Page } from "@playwright/test";

async function expectHealthyRoute(page: Page, path: string, heading: string | RegExp) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  const response = await page.goto(path);
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
}

for (const route of [
  { path: "/", heading: "Week of Us" },
  { path: "/onboarding", heading: /.+–.+/ },
  { path: "/planner", heading: /.+–.+/ },
  { path: "/privacy", heading: "Privacy Policy" },
  { path: "/terms", heading: "Terms of Service" },
  { path: "/support", heading: "Week of Us Support" },
]) {
  test(`${route.path} renders without browser errors`, async ({ page }) => {
    await expectHealthyRoute(page, route.path, route.heading);
  });
}

test("Settings renders and hydrates its client controls", async ({ page }) => {
  await expectHealthyRoute(page, "/settings", "Settings");
  const theme = page.getByLabel("Theme");
  await expect(theme).toHaveValue("light");
  await theme.selectOption("dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("a planner reminder link opens its item", async ({ page }) => {
  await page.goto("/");
  const plannerHref = await page.getByRole("link", { name: /Open interactive planner/ }).getAttribute("href");
  expect(plannerHref).toBeTruthy();
  const reminderURL = new URL(plannerHref!, "http://127.0.0.1:3000");
  reminderURL.searchParams.set("item", "demo-t1");

  await page.goto(`${reminderURL.pathname}${reminderURL.search}`);
  await expect(page.getByRole("heading", { name: "Edit planning item" })).toBeVisible();
  await expect(page.getByLabel("Text")).toHaveValue("Groceries");
});
