import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/useRealtime";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { useState } from "react";
async function fetchDevices() {
  const { data, error } = await supabase.from("devices").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

async function fetchEvents(filter: { deviceId?: string; type?: string }) {
  let query = supabase
    .from("sensor_events")
    .select("id, device_id, timestamp, event_type, value, device:devices(name)")
    .order("timestamp", { ascending: false })
    .limit(200);

  if (filter.deviceId) query = query.eq("device_id", filter.deviceId);
  if (filter.type) query = query.eq("event_type", filter.type);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export default function EventsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<{ deviceId?: string; type?: string }>({});
  const { data: devices = [] } = useQuery({ queryKey: ["devices-min"], queryFn: fetchDevices });
  const { data: events = [] } = useQuery({ queryKey: ["sensor_events", filter], queryFn: () => fetchEvents(filter) });

  useRealtimeTables(["sensor_events"], () => qc.invalidateQueries({ queryKey: ["sensor_events"] }));

  return (
    <main className="container py-6 space-y-4">
      <h1 className="text-2xl font-semibold">Sensor Events</h1>

      <div className="flex flex-wrap gap-4 items-center">
        <Select onValueChange={(v) => setFilter((f) => ({ ...f, deviceId: v || undefined }))}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Filter by device" /></SelectTrigger>
          <SelectContent>
            {devices.map((d: any) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={(v) => setFilter((f) => ({ ...f, type: v || undefined }))}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Filter by type" /></SelectTrigger>
          <SelectContent>
            {["update_state", "open", "close", "scene_applied"].map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section className="grid gap-3">
        {events.map((e: any) => (
          <Card key={e.id}>
            <CardContent className="py-3 flex items-center justify-between">
              <div className="text-sm">
                <div className="font-medium">{e.device?.name || e.device_id}</div>
                <div className="text-muted-foreground">{new Date(e.timestamp).toLocaleString()}</div>
              </div>
              <div className="text-right text-sm">
                <div className="font-medium">{e.event_type}</div>
                <div className="text-muted-foreground truncate max-w-[320px]">{JSON.stringify(e.value)}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
