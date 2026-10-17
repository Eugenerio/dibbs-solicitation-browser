// Shared JSON response helper for the API routes (not a route: only route.ts files are).
export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
