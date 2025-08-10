import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/useRealtime";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { useState, useMemo } from "react";

async function fetchDevices() {
  const { data, error } = await supabase.from("devices").select("id,name,location_id").order("name");
  if (error) throw error;
  return data || [];
}

async function fetchLocations() {
  const { data, error } = await supabase.from("locations").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

async function fetchEvents(filter: { deviceId?: string; type?: string; sinceIso?: string }) {
  let query = supabase
    .from("sensor_events")
    .select("id, device_id, timestamp, event_type, value, device:devices(id,name,location_id, location:locations(name))")
    .order("timestamp", { ascending: false })
    .limit(200);

  if (filter.deviceId) query = query.eq("device_id", filter.deviceId);
  if (filter.type) query = query.eq("event_type", filter.type);
  if (filter.sinceIso) query = query.gte("timestamp", filter.sinceIso);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export default function EventsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<{ deviceId?: string; type?: string; locationId?: string; window: string }>({ window: "24h" });

  const { data: devices = [] } = useQuery({ queryKey: ["devices-min"], queryFn: fetchDevices });
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });

  const sinceIso = useMemo(() => {
    if (filter.window === "all") return undefined;
    const map: Record<string, number> = { "1h": 3600e3, "24h": 24 * 3600e3, "7d": 7 * 24 * 3600e3 };
    const ms = map[filter.window] ?? 24 * 3600e3;
    return new Date(Date.now() - ms).toISOString();
  }, [filter.window]);

  const { data: events = [] } = useQuery({
    queryKey: ["sensor_events", filter.deviceId, filter.type, sinceIso],
    queryFn: () => fetchEvents({ deviceId: filter.deviceId, type: filter.type, sinceIso }),
  });

  useRealtimeTables(["sensor_events"], () => qc.invalidateQueries({ queryKey: ["sensor_events"] }));

  const filteredEvents = useMemo(() => {
    if (!filter.locationId) return events;
    return events.filter((e: any) => e.device?.location_id === filter.locationId);
  }, [events, filter.locationId]);

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

        <Select value={filter.window} onValueChange={(v) => setFilter((f) => ({ ...f, window: v }))}>
          <SelectTrigger className="w-[160px]"><SelectValue placeholder="Time window" /></SelectTrigger>
          <SelectContent>
            {[["1h","Last hour"],["24h","Last 24h"],["7d","Last 7 days"],["all","All"]].map(([v,l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={(v) => setFilter((f) => ({ ...f, locationId: v || undefined }))}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Filter by location" /></SelectTrigger>
          <SelectContent>
            {locations.map((l: any) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section className="grid gap-3">
        {filteredEvents.map((e: any) => (
          <Card key={e.id}>
            <CardContent className="py-3 flex items-center justify-between">
              <div className="text-sm">
                <div className="font-medium">{e.device?.name || e.device_id}</div>
                <div className="text-muted-foreground">{new Date(e.timestamp).toLocaleString()} • {e.device?.location?.name || "-"}</div>
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
