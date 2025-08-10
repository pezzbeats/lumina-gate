import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RelayBody {
  url: string;
  payload: Record<string, unknown>;
  background?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as RelayBody;
    if (!body?.url) {
      return new Response(JSON.stringify({ error: "Missing url" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    if (body.background) {
      // fire-and-forget mode
      // Use background task so response is returned immediately
      // deno-lint-ignore no-explicit-any
      (globalThis as any).EdgeRuntime?.waitUntil(
        fetch(body.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body.payload ?? {}),
        })
          .then(async (r) => {
            const t = await r.text();
            console.log("relay-webhook background response:", r.status, r.statusText, t);
          })
          .catch((e) => console.error("relay-webhook background error:", e))
      );

      return new Response(
        JSON.stringify({ ok: true, accepted: true }),
        { status: 202, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const response = await fetch(body.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body.payload ?? {}),
    });

    const text = await response.text();

    return new Response(
      JSON.stringify({
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        body: text,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
