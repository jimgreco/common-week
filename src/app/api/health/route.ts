export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      status: "ok",
      build: process.env.APP_BUILD ?? "local",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
