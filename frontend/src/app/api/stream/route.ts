export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const upstream = process.env.API_STREAM_URL; // <-- server-only env var
  if (!upstream) return new Response("Missing API_STREAM_URL", { status: 500 });

  const upstreamRes = await fetch(upstream, {
    headers: { Accept: "text/event-stream" },
    cache: "no-store",
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    return new Response(`Upstream error: ${upstreamRes.status}`, { status: 502 });
  }

  const { readable, writable } = new TransformStream();
  upstreamRes.body.pipeTo(writable).catch(() => {});

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      // IMPORTANT: do NOT set "Connection" manually on Vercel/Fetch responses
      "X-Accel-Buffering": "no",
    },
  });
}
