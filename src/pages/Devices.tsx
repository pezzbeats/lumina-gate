import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/useRealtime";
import { DeviceCard, Device, DeviceType } from "@/components/devices/DeviceCard";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

async function fetchDevices(): Promise<Device[]> {
  const { data, error } = await supabase
    .from("devices")
    .select("id,name,type,location_id,state,metadata,last_seen, location:locations(id,name)")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data as any) || [];
}

async function fetchLocations() {
  const { data, error } = await supabase.from("locations").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

async function fetchSettings() {
  const { data, error } = await supabase.from("app_settings").select("id,webhook_url").limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

const DEVICE_TYPES: DeviceType[] = ["light", "fan", "ac", "curtain", "geyser", "sensor"];

export default function DevicesPage() {
  const qc = useQueryClient();
  const { data: devices = [] } = useQuery({ queryKey: ["devices"], queryFn: fetchDevices });
  const { data: settings } = useQuery({ queryKey: ["app_settings"], queryFn: fetchSettings });
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });

  useRealtimeTables(["devices"], () => qc.invalidateQueries({ queryKey: ["devices"] }));

  // Optimistic state update & webhook relay for control actions
  const controlMutation = useMutation({
    mutationFn: async ({ id, newState, action }: { id: string; newState: any; action: string }) => {
      const { error } = await supabase
        .from("devices")
        .update({ state: newState, last_seen: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      await supabase.from("sensor_events").insert({ device_id: id, event_type: action, value: newState });

      if (settings?.webhook_url) {
        await supabase.functions.invoke("relay-webhook", {
          body: {
            url: settings.webhook_url,
            payload: { type: "device_action", device_id: id, action, state: newState },
          },
        });
      }
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["devices"] });
      const previous = qc.getQueryData<Device[]>(["devices"]) || [];
      qc.setQueryData<Device[]>(["devices"], (old) => (old || []).map((d) => (d.id === vars.id ? { ...d, state: vars.newState } : d)));
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["devices"], ctx.previous);
      toast({ title: "Action failed" });
    },
    onSuccess: () => toast({ title: "Device updated" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["devices"] }),
  });

  // Create Device
  const [openCreate, setOpenCreate] = useState(false);
  const [createForm, setCreateForm] = useState<{ name: string; type?: DeviceType; location_id?: string; initState: string }>(
    { name: "", type: undefined, location_id: undefined, initState: "{}" }
  );

  const createDevice = useMutation({
    mutationFn: async () => {
      if (!createForm.name || !createForm.type || !createForm.location_id) {
        throw new Error("Missing required fields");
      }
      let initState: any = {};
      try { initState = JSON.parse(createForm.initState || "{}"); } catch { throw new Error("Invalid JSON for initial state"); }
      const { error } = await supabase.from("devices").insert({
        name: createForm.name,
        type: createForm.type,
        location_id: createForm.location_id,
        state: initState,
        metadata: { endpoint: "https://example.com/mock-endpoint" },
        last_seen: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Device created" });
      setOpenCreate(false);
      setCreateForm({ name: "", type: undefined, location_id: undefined, initState: "{}" });
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  // Edit Device
  const [openEdit, setOpenEdit] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; type: DeviceType | undefined; location_id: string | undefined }>({ name: "", type: undefined, location_id: undefined });

  const updateDevice = useMutation({
    mutationFn: async () => {
      if (!editId || !editForm.name || !editForm.type || !editForm.location_id) throw new Error("Missing fields");
      const { error } = await supabase
        .from("devices")
        .update({ name: editForm.name, type: editForm.type, location_id: editForm.location_id })
        .eq("id", editId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Device updated" });
      setOpenEdit(false);
      setEditId(null);
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  // Delete Device
  const deleteDevice = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("devices").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Device deleted" });
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  // Test Device Webhook
  const testDevice = useMutation({
    mutationFn: async (device: Device) => {
      if (!settings?.webhook_url) throw new Error("Set webhook URL in Settings");
      const { data: resp, error } = await supabase.functions.invoke("relay-webhook", {
        body: {
          url: settings.webhook_url,
          payload: {
            type: "device_test",
            device_id: device.id,
            device_type: device.type,
            state: device.state,
            metadata: device.metadata,
            timestamp: new Date().toISOString(),
          },
        },
      });
      if (error || (resp && (resp as any).ok === false)) {
        throw new Error((error as any)?.message || (resp as any)?.statusText || "Webhook failed");
      }
    },
    onSuccess: () => toast({ title: "Test sent" }),
    onError: (e) => toast({ title: `Test failed: ${String(e)}` }),
  });

  return (
    <main className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Devices</h1>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button>Add Device</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Device</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Name" value={createForm.name} onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))} />
              <Select onValueChange={(v) => setCreateForm((f) => ({ ...f, type: v as DeviceType }))}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {DEVICE_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select onValueChange={(v) => setCreateForm((f) => ({ ...f, location_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l: any) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
                </SelectContent>
              </Select>
              <div>
                <label className="text-sm font-medium">Initial state (JSON)</label>
                <textarea className="w-full min-h-24 rounded-md border bg-background p-2 text-sm" value={createForm.initState} onChange={(e) => setCreateForm((f) => ({ ...f, initState: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button disabled={!createForm.name || !createForm.type || !createForm.location_id} onClick={() => createDevice.mutate()}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            onChange={(ns, action) => controlMutation.mutate({ id: d.id, newState: ns, action })}
            onEdit={() => {
              setEditId(d.id);
              setEditForm({ name: d.name, type: d.type, location_id: d.location_id });
              setOpenEdit(true);
            }}
            onDelete={() => deleteDevice.mutate(d.id)}
            onTest={() => testDevice.mutate(d)}
          />
        ))}
      </section>

      <Dialog open={openEdit} onOpenChange={setOpenEdit}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Device</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Name" value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
            <Select value={editForm.type} onValueChange={(v) => setEditForm((f) => ({ ...f, type: v as DeviceType }))}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                {DEVICE_TYPES.map((t) => (<SelectItem key={t} value={t}>{t}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={editForm.location_id} onValueChange={(v) => setEditForm((f) => ({ ...f, location_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
              <SelectContent>
                {locations.map((l: any) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button onClick={() => updateDevice.mutate()} disabled={!editForm.name || !editForm.type || !editForm.location_id}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
