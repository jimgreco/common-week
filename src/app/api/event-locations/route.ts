import type { NextRequest } from "next/server";
import { z } from "zod";
import { GooglePlacesApiError, googlePlacesService } from "@/lib/integrations/google-places";
import { getUserContext } from "@/lib/server/auth";

export const runtime = "nodejs";

const sessionToken = z.string().uuid();
const biasSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

function response(ok: boolean, data?: unknown, error?: string, status = ok ? 200 : 400) {
  return Response.json({ ok, ...(data === undefined ? {} : { data }), ...(error ? { error } : {}) }, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function failure(error: unknown) {
  if (error instanceof z.ZodError) return response(false, undefined, "Enter a valid location search.", 400);
  if (error instanceof GooglePlacesApiError) {
    const status = error.statusCode === undefined ? 503 : 502;
    return response(false, undefined, error.message, status);
  }
  console.error("Event location search failed:", error);
  return response(false, undefined, "Location suggestions are temporarily unavailable.", 500);
}

export async function GET(request: NextRequest) {
  if (!(await getUserContext())) return response(false, undefined, "Authentication required.", 401);
  try {
    const query = z.string().trim().min(2).max(120).parse(request.nextUrl.searchParams.get("q") ?? "");
    const token = sessionToken.parse(request.nextUrl.searchParams.get("sessionToken") ?? "");
    const latitude = request.nextUrl.searchParams.get("latitude");
    const longitude = request.nextUrl.searchParams.get("longitude");
    let bias: z.infer<typeof biasSchema> | undefined;
    if (latitude !== null || longitude !== null) {
      const [latitudeValue, longitudeValue] = z.tuple([z.string(), z.string()]).parse([latitude, longitude]);
      bias = biasSchema.parse({ latitude: latitudeValue, longitude: longitudeValue });
    }
    return response(true, await googlePlacesService.autocomplete(query, token, bias));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest) {
  if (!(await getUserContext())) return response(false, undefined, "Authentication required.", 401);
  try {
    const input = z.object({
      placeId: z.string().trim().min(1).max(512),
      sessionToken,
      suggestedText: z.string().trim().min(1).max(1000),
    }).parse(await request.json());
    return response(true, await googlePlacesService.resolve(input.placeId, input.sessionToken, input.suggestedText));
  } catch (error) {
    return failure(error);
  }
}
