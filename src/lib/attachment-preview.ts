type PreviewKind = "image" | "pdf" | "text" | "audio" | "video";

// Only inert formats are previewed. HTML, SVG, and unknown files stay downloads.
const formats: Record<string, [string, PreviewKind]> = {
  pdf: ["application/pdf", "pdf"],
  png: ["image/png", "image"],
  jpg: ["image/jpeg", "image"],
  jpeg: ["image/jpeg", "image"],
  gif: ["image/gif", "image"],
  webp: ["image/webp", "image"],
  avif: ["image/avif", "image"],
  txt: ["text/plain", "text"],
  md: ["text/plain", "text"],
  csv: ["text/csv", "text"],
  json: ["application/json", "text"],
  mp3: ["audio/mpeg", "audio"],
  m4a: ["audio/mp4", "audio"],
  wav: ["audio/wav", "audio"],
  ogg: ["audio/ogg", "audio"],
  mp4: ["video/mp4", "video"],
  mov: ["video/quicktime", "video"],
  webm: ["video/webm", "video"],
};

export function attachmentFormat(name: string) {
  const extension = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  const format = Object.hasOwn(formats, extension) ? formats[extension] : undefined;
  return { mimeType: format?.[0] ?? "application/octet-stream", preview: format?.[1] ?? null };
}
