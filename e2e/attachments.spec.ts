import { expect, test } from "@playwright/test";

for (const item of [{ id: "demo-t1", kind: "task" }, { id: "demo-p1", kind: "note" }]) {
  test(`${item.kind} attachments preview and keep an external download option`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/");
    const href = await page.getByRole("link", { name: /Open interactive planner/ }).getAttribute("href");
    const url = new URL(href!, "http://127.0.0.1:3000");
    url.searchParams.set("item", item.id);
    await page.goto(url.pathname + url.search);
    await expect(page.getByText("Responsibility, deadline & shared details", { exact: true })).toHaveCount(0);
    const upload = page.getByLabel("Attach a file");
    await upload.setInputFiles({ name: "Packing.txt", mimeType: "text/plain", buffer: Buffer.from("Bring towels and sunscreen.") });
    await page.getByRole("button", { name: "Open Packing.txt", exact: true }).click();
    const preview = page.getByRole("region", { name: "Preview Packing.txt", exact: true });
    await expect(preview).toContainText("Bring towels and sunscreen.");
    const download = page.waitForEvent("download");
    await preview.getByRole("link", { name: "Download file" }).click();
    expect((await download).suggestedFilename()).toBe("Packing.txt");
    await preview.getByRole("button", { name: "Close preview" }).click();
    await expect(preview).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Edit planning item" })).toBeVisible();

    await upload.setInputFiles({ name: "Photo.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=", "base64") });
    await page.getByRole("button", { name: "Open Photo.png", exact: true }).click();
    await expect(page.getByRole("img", { name: "Photo.png", exact: true })).toBeVisible();
    await expect.poll(() => page.getByRole("img", { name: "Photo.png", exact: true }).evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBe(1);

    // Uploaded active content must remain a file rather than execute as an app page.
    await upload.setInputFiles({ name: "Page.html", mimeType: "text/html", buffer: Buffer.from("<script>window.attachmentExecuted=true</script>") });
    await page.getByRole("button", { name: "Open Page.html", exact: true }).click();
    await expect(page.getByRole("region", { name: "Preview Page.html" })).toContainText("A preview isn’t available");
    expect(await page.evaluate(() => "attachmentExecuted" in window)).toBe(false);

    // Use a real PDF, keeping the fixture self-contained.
    const objects = ["1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n", "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n", "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"];
    const stream = "BT /F1 20 Tf 30 230 Td (Family packing list) Tj ET";
    objects.push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
    let pdf = "%PDF-1.4\n";
    const offsets = objects.map((object) => { const offset = pdf.length; pdf += object; return offset; });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    await upload.setInputFiles({ name: "Family.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) });
    await page.getByRole("button", { name: "Open Family.pdf", exact: true }).click();
    await expect(page.getByTitle("Preview Family.pdf", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${item.kind}-attachment-preview.png`) });
    await page.getByRole("button", { name: "Close preview" }).click();

    // Missing bytes report a retryable error without dismissing shared details.
    await page.evaluate(() => {
      const data = JSON.parse(localStorage.getItem("weekofus-task-workspace")!);
      data.files = {};
      localStorage.setItem("weekofus-task-workspace", JSON.stringify(data));
    });
    await page.getByRole("button", { name: "Open Packing.txt", exact: true }).click();
    await expect(page.getByRole("region", { name: "Shared item details" }).getByRole("alert")).toContainText("File could not be opened. Try again.");
    await expect(page.getByRole("button", { name: "Open Packing.txt", exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
}
