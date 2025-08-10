import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/useRealtime";
import { DeviceCard, Device } from "@/components/devices/DeviceCard";
import { toast } from "sonner";

async function fetchDevices(): Promise<Device[]> {
  const { data, error } = await supabase
    .from("devices")
    .select("id,name,type,location_id,state,metadata,last_seen, location:locations(id,name)")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data as any) || [];
}

async function fetchSettings() {
  const { data, error } = await supabase.from("app_settings").select("id,webhook_url").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

export default function DevicesPage() {
  const qc = useQueryClient();
  const { data: devices = [] } = useQuery({ queryKey: ["devices"], queryFn: fetchDevices });
  const { data: settings } = useQuery({ queryKey: ["app_settings"], queryFn: fetchSettings });

  useRealtimeTables(["devices"], () => qc.invalidateQueries({ queryKey: ["devices"] }));

  const mutation = useMutation({
    mutationFn: async ({ id, newState, action }: { id: string; newState: any; action: string }) => {
      // Persist to DB
      const { error } = await supabase
        .from("devices")
        .update({ state: newState, last_seen: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;

      // Log sensor event
      await supabase.from("sensor_events").insert({ device_id: id, event_type: action, value: newState });

      // Relay to webhook via Edge Function
      if (settings?.webhook_url) {
        const { data, error: fnError } = await supabase.functions.invoke("relay-webhook", {
          body: {
            url: settings.webhook_url,
            payload: { type: "device_action", device_id: id, action, state: newState },
          },
        });
        if (fnError || (data && (data as any).ok === false)) {
          throw new Error((fnError as any)?.message || "Webhook failed");
        }
      }
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["devices"] });
      const previous = qc.getQueryData<Device[]>(["devices"]) || [];
      qc.setQueryData<Device[]>(["devices"], (old) => (old || []).map((d) => (d.id === vars.id ? { ...d, state: vars.newState } : d)));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      // Rollback
      if (ctx?.previous) qc.setQueryData(["devices"], ctx.previous);
      toast.error(`Action failed: ${String(err)}`);
    },
    onSuccess: () => {
      toast.success("Device updated");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
  });

  return (
    <main className="container py-6">
      <h1 className="text-2xl font-semibold mb-4">Devices</h1>
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            onChange={(ns, action) => mutation.mutate({ id: d.id, newState: ns, action })}
          />)
        )}
      </section>
    </main>
  );
}
