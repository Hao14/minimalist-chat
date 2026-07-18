export const dynamic = "force-static";

export const HEALTH_PAYLOAD = {
  status: "ok",
  service: "web",
} as const;

export function GET() {
  return Response.json(HEALTH_PAYLOAD, {
    status: 200,
    headers: {
      "cache-control": "no-store",
    },
  });
}
