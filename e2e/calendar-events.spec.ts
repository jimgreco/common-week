import { expect, test } from "@playwright/test";

test("event save errors stay visible above the sticky buttons and preserve a corrected retry", async ({ page }) => {
  await page.goto("/planner?week=2026-03-02");
  await page.getByRole("region", { name: "Calendar for Sunday, March 8", exact: true }).getByRole("button", { name: "Add event" }).click();
  const editor = page.getByRole("dialog", { name: "Add Google event" });
  await editor.getByRole("textbox", { name: "Title", exact: true }).fill("DST recovery check");
  const times = editor.getByRole("textbox", { name: "Time", exact: true });
  await times.nth(0).fill("02:30");
  await times.nth(1).fill("03:30");
  await editor.getByRole("button", { name: "Add event", exact: true }).click();

  const error = editor.getByRole("alert");
  await expect(error).toHaveText("That time does not exist because the clocks change. Choose another time.");
  await expect.poll(async () => {
    const message = await error.boundingBox();
    const footer = await editor.locator(".modal-footer").boundingBox();
    return Boolean(message && footer && message.y >= 0 && message.y + message.height <= footer.y);
  }).toBe(true);
  await expect(editor.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("DST recovery check");
  await expect(times.nth(0)).toHaveValue("02:30");

  await times.nth(0).fill("01:30");
  await editor.getByRole("button", { name: "Add event", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("region", { name: "Calendar for Sunday, March 8", exact: true })
    .getByRole("button", { name: "DST recovery check, 1:30–3:30 AM. Open details.", exact: true })).toBeVisible();
});
