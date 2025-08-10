import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type Action =
  | { action: "update_device_state"; id: string; newState: unknown; eventAction?: string }
  | { action: "create_device"; name: string; type: string; location_id: string; state?: unknown; metadata?: Record<string, unknown> }
  | { action: "update_device"; id: string; name: string; type: string; location_id: string }
  | { action: "delete_device"; id: string };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Action;

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing Supabase env variables");
      return new Response(JSON.stringify({ error: "Missing Supabase env" }), { status: 500, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    switch (body.action) {
      case "update_device_state": {
        if (!body.id) {
          return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: corsHeaders });
        }
        const { error: uerr } = await supabase
          .from("devices")
          .update({ state: body.newState ?? {}, last_seen: new Date().toISOString() })
          .eq("id", body.id);
        if (uerr) {
          console.error("update_device_state error", uerr);
          return new Response(JSON.stringify({ error: uerr.message }), { status: 400, headers: corsHeaders });
        }
        const { error: ierr } = await supabase.from("sensor_events").insert({
          device_id: body.id,
          event_type: body.eventAction ?? "device_action",
          value: body.newState ?? {},
        });
        if (ierr) {
          console.error("sensor_events insert error", ierr);
          // return success for device update even if logging fails
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }
      case "create_device": {
        const { name, type, location_id } = body as any;
        if (!name || !type || !location_id) {
          return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: corsHeaders });
        }
        const { error } = await supabase.from("devices").insert({
          name,
          type,
          location_id,
          state: (body as any).state ?? {},
          metadata: (body as any).metadata ?? {},
          last_seen: new Date().toISOString(),
        });
        if (error) {
          console.error("create_device error", error);
          return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }
      case "update_device": {
        const { id, name, type, location_id } = body as any;
        if (!id || !name || !type || !location_id) {
          return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers: corsHeaders });
        }
        const { error } = await supabase
          .from("devices")
          .update({ name, type, location_id })
          .eq("id", id);
        if (error) {
          console.error("update_device error", error);
          return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }
      case "delete_device": {
        const { id } = body as any;
        if (!id) {
          return new Response(JSON.stringify({ error: "Missing id" }), { status: 400, headers: corsHeaders });
        }
        const { error } = await supabase.from("devices").delete().eq("id", id);
        if (error) {
          console.error("delete_device error", error);
          return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
        }
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }
      default:
        return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });
    }
  } catch (e) {
    console.error("device-admin exception", e);
    return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: corsHeaders });
  }
});
