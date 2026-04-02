import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/useRealtime";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import { Zap } from "lucide-react";

const EVENT_TYPES = ["update_state", "open", "close", "scene_applied", "motion_detected", "temperature_reading", "power_on", "power_off"];

async function fetchDevices() {
  const { data, error } = await supabase.from("devices").select("id,name,location_id,type").order("name");
  if (error) throw error;
  return data || [];
}

async function fetchLocations() {
  const { data, error } = await supabase.from("locations").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

async function fetchSettings() {
  const { data, error } = await supabase
    .from("app_settings")
    .select("id,webhook_url,sensor_event_webhook_url")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
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
  const { data: settings } = useQuery({ queryKey: ["app_settings"], queryFn: fetchSettings });

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

  // Simulate event dialog state
  const [simOpen, setSimOpen] = useState(false);
  const [simForm, setSimForm] = useState<{ device_id: string; event_type: string; valueJson: string }>({
    device_id: "",
    event_type: "motion_detected",
    valueJson: '{"triggered": true}',
  });

  const simulateEvent = useMutation({
    mutationFn: async () => {
      if (!simForm.device_id || !simForm.event_type) throw new Error("Device and event type required");
      let value: any;
      try { value = JSON.parse(simForm.valueJson || "{}"); } catch { throw new Error("Invalid JSON for value"); }

      const { error: insertErr } = await supabase.from("sensor_events").insert({
        device_id: simForm.device_id,
        event_type: simForm.event_type,
        value,
        timestamp: new Date().toISOString(),
      });
      if (insertErr) throw insertErr;

      const webhookUrl = settings?.sensor_event_webhook_url || settings?.webhook_url;
      if (webhookUrl) {
        const device = (devices as any[]).find((d) => d.id === simForm.device_id);
        const payload = {
          source: "dashboard",
          action: "sensor_event",
          device_id: simForm.device_id,
          location_id: device?.location_id,
          device_type: device?.type,
          desired_state: value,
          event_type: simForm.event_type,
          timestamp: new Date().toISOString(),
        };
        supabase.functions.invoke("relay-webhook", { body: { url: webhookUrl, background: true, payload } });
        supabase.from("webhook_logs").insert({
          webhook_type: "sensor_event",
          url: webhookUrl,
          payload,
          status: 202,
        });
      }
    },
    onSuccess: () => {
      toast({ title: "Sensor event simulated" });
      setSimOpen(false);
      qc.invalidateQueries({ queryKey: ["sensor_events"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  return (
    <main className="container py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Sensor Events</h1>
        <Button onClick={() => setSimOpen(true)} variant="secondary">
          <Zap className="h-4 w-4 mr-2" />
          Simulate Event
        </Button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Select onValueChange={(v) => setFilter((f) => ({ ...f, deviceId: v === "all" ? undefined : v }))}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Filter by device" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All devices</SelectItem>
            {(devices as any[]).map((d: any) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select onValueChange={(v) => setFilter((f) => ({ ...f, type: v === "all" ? undefined : v }))}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Filter by type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {EVENT_TYPES.map((t) => (
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

        <Select onValueChange={(v) => setFilter((f) => ({ ...f, locationId: v === "all" ? undefined : v }))}>
          <SelectTrigger className="w-[220px]"><SelectValue placeholder="Filter by location" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {(locations as any[]).map((l: any) => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {filteredEvents.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          No events found. Use "Simulate Event" to generate test data.
        </div>
      ) : (
        <section className="grid gap-3">
          {filteredEvents.map((e: any) => (
            <Card key={e.id}>
              <CardContent className="py-3 flex items-center justify-between gap-4">
                <div className="text-sm min-w-0">
                  <div className="font-medium">{e.device?.name || e.device_id}</div>
                  <div className="text-muted-foreground text-xs">{new Date(e.timestamp).toLocaleString()} • {e.device?.location?.name || "—"}</div>
                </div>
                <div className="text-right text-sm shrink-0">
                  <div className="font-medium">{e.event_type}</div>
                  <div className="text-muted-foreground text-xs truncate max-w-[280px]">{JSON.stringify(e.value)}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* Simulate Event Dialog */}
      <Dialog open={simOpen} onOpenChange={setSimOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Simulate Sensor Event</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">Device</label>
              <Select value={simForm.device_id} onValueChange={(v) => setSimForm((f) => ({ ...f, device_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select device" /></SelectTrigger>
                <SelectContent>
                  {(devices as any[]).map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Event Type</label>
              <Select value={simForm.event_type} onValueChange={(v) => setSimForm((f) => ({ ...f, event_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Value (JSON)</label>
              <textarea
                className="w-full min-h-24 rounded-md border bg-background p-2 text-sm font-mono"
                value={simForm.valueJson}
                onChange={(e) => setSimForm((f) => ({ ...f, valueJson: e.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              This will insert a sensor_events record and trigger the sensor webhook if configured.
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setSimOpen(false)}>Cancel</Button>
            <Button
              onClick={() => simulateEvent.mutate()}
              disabled={!simForm.device_id || !simForm.event_type || simulateEvent.isPending}
            >
              Simulate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
