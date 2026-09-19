"use client";

import { useEffect, useRef, useState } from "react";
import { attachmentFormat } from "@/lib/attachment-preview";

export function AttachmentPreview({ file, url, onClose }: { file: File; url: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);
  const format = attachmentFormat(file.name);
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });

  useEffect(() => {
    let active = true;
    if (format.preview === "text") {
      void file.text().then((value) => { if (active) setText(value); }).catch(() => {
        if (active) setError("This file could not be previewed. You can still download it.");
      });
    }
    panel.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    return () => { active = false; };
  }, [file, format.preview]);

  async function share() {
    try {
      await navigator.share({ files: [file], title: file.name });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setError("The file could not be shared. Download it to open it in another app.");
      }
    }
  }

  return (
    <section ref={panel} className="attachment-preview" aria-label={`Preview ${file.name}`}>
      <div className="attachment-preview-toolbar">
        <strong>{file.name}</strong>
        <button type="button" onClick={onClose}>Close preview</button>
      </div>
      <div className="attachment-preview-actions">
        {canShare && <button type="button" onClick={() => void share()}>Open in or share…</button>}
        {url && <a href={url} download={file.name}>Download file</a>}
      </div>
      {error && <p role="alert">{error}</p>}
      {url && !error && <>
        {/* Local attachment URLs cannot use the Next image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {format.preview === "image" && <img src={url} alt={file.name} onError={() => setError("This image could not be previewed. Download it to open it in another app.")} />}
        {format.preview === "pdf" && <iframe title={`Preview ${file.name}`} src={url} />}
        {format.preview === "text" && <pre>{text}</pre>}
        {format.preview === "audio" && <audio controls src={url} onError={() => setError("This audio format cannot play here. Download it to open it in another app.")} />}
        {format.preview === "video" && <video controls src={url} onError={() => setError("This video format cannot play here. Download it to open it in another app.")} />}
      </>}
      {!format.preview && <p>A preview isn’t available for this file. Open it in a compatible app using the options above.</p>}
      <p className="muted">You can open the downloaded file in its usual app.</p>
    </section>
  );
}
