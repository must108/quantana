export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const upstream = process.env.NEXT_PUBLIC_API!;

  const res = await fetch(upstream, {
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    cache: "no-store",
  });

  if (!res.ok || !res.body) {
    return new Response(`Upstream error: ${res.status}`, { status: 502 });
  }

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
