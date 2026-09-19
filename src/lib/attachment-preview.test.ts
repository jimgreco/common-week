import { describe, expect, it } from "vitest";
import { attachmentFormat } from "./attachment-preview";

describe("attachment previews", () => {
  it("recognizes supported files without depending on the download response MIME type", () => {
    expect(attachmentFormat("School form.PDF")).toEqual({ mimeType: "application/pdf", preview: "pdf" });
    expect(attachmentFormat("trip.photo.jpeg").preview).toBe("image");
    expect(attachmentFormat("packing.txt").preview).toBe("text");
    expect(attachmentFormat("recording.m4a").preview).toBe("audio");
    expect(attachmentFormat("clip.mp4").preview).toBe("video");
  });
  it("never renders uploaded active documents or unknown formats as web pages", () => {
    for (const name of ["page.html", "image.svg", "page.xhtml", "script.js", "file", "data.bin", "file.constructor", "file.__proto__"]) {
      expect(attachmentFormat(name)).toEqual({ mimeType: "application/octet-stream", preview: null });
    }
  });
});
