import { NextRequest } from "next/server";
import { z } from "zod";
import {
  loadTaskWorkspace,
  mutateTaskWorkspace,
  downloadCollaborationFile,
} from "@/lib/server/task-workspace";
import { revalidatePath } from "next/cache";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    if (params.has("file")) {
      const file = await downloadCollaborationFile(
        z.string().uuid().parse(params.get("file")),
      );
      const name = file.text.replace(/[\r\n\\/]/g, "_").slice(0, 200);
      return new Response(new Uint8Array(file.file_data), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    const resource = params.has("itemId")
      ? { itemId: params.get("itemId") }
      : params.has("calendarId")
        ? {
            calendarId: params.get("calendarId"),
            eventId: params.get("eventId"),
          }
        : undefined;
    return Response.json(
      { ok: true, data: await loadTaskWorkspace(resource) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host"))
      throw new Error("This request is not allowed.");
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new Error("Expected a JSON request.");
    // Bound the body while reading; Content-Length can be absent or inaccurate.
    const reader = request.body?.getReader();
    if (!reader) throw new Error("The request is empty.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 7100000) {
        await reader.cancel();
        throw new Error("Files must be no larger than 5 MB.");
      }
      chunks.push(value);
    }
    await mutateTaskWorkspace(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    revalidatePath("/planner");
    return Response.json(
      { ok: true, data: {} },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown) {
  return Response.json(
    {
      ok: false,
      error:
        error instanceof z.ZodError
          ? "Check the details and try again."
          : error instanceof Error
            ? error.message
            : "This change could not be saved.",
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
