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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

async function fetchDevices(): Promise<Device[]> {
  const { data, error } = await supabase
    .from("devices")
    .select("id,name,type,location_id,power,state,metadata,last_seen, location:locations(id,name)")
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
  const { data, error } = await supabase
    .from("app_settings")
    .select("id,webhook_url,device_toggle_webhook_url,scene_activate_webhook_url,sensor_event_webhook_url")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const DEVICE_TYPES: DeviceType[] = ["light", "fan", "ac", "curtain", "geyser", "sensor", "smart_plug", "ir_blaster"];

// Returns the effective device toggle webhook URL (specific > general)
function getToggleUrl(settings: any): string | null {
  return settings?.device_toggle_webhook_url || settings?.webhook_url || null;
}

export default function DevicesPage() {
  const qc = useQueryClient();
  const { data: devices = [] } = useQuery({ queryKey: ["devices"], queryFn: fetchDevices });
  const { data: settings } = useQuery({ queryKey: ["app_settings"], queryFn: fetchSettings });
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });

  useRealtimeTables(["devices"], () => qc.invalidateQueries({ queryKey: ["devices"] }));

  const [typeFilter, setTypeFilter] = useState<DeviceType | "all">("all");
  const [powerFilter, setPowerFilter] = useState<"all" | "on" | "off">("all");
  const [locationFilter, setLocationFilter] = useState<string>("all");

  const filteredDevices = (devices || []).filter((d) => {
    const typeOk = typeFilter === "all" || d.type === typeFilter;
    const isOn = (d as any).power ?? Boolean((d as any).state?.power);
    const powerOk = powerFilter === "all" || (powerFilter === "on" ? isOn === true : isOn === false);
    const locOk = locationFilter === "all" || d.location_id === locationFilter;
    return typeOk && powerOk && locOk;
  });

  // Optimistic state update & webhook relay for control actions
  const controlMutation = useMutation({
    mutationFn: async ({ id, newState, action, device }: { id: string; newState: any; action: string; device: Device }) => {
      const { error } = await supabase.functions.invoke("device-admin", {
        body: { action: "update_device_state", id, newState, eventAction: action },
      });
      if (error) throw error;

      const webhookUrl = getToggleUrl(settings);
      if (webhookUrl) {
        const payload = {
          source: "dashboard",
          action: "toggle",
          device_id: id,
          location_id: device.location_id,
          device_type: device.type,
          desired_state: newState,
          timestamp: new Date().toISOString(),
        };
        // Fire and forget + log
        supabase.functions.invoke("relay-webhook", {
          body: { url: webhookUrl, background: true, payload },
        });
        supabase.from("webhook_logs").insert({
          webhook_type: "device_toggle",
          url: webhookUrl,
          payload,
          status: 202,
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
      const { error } = await supabase.functions.invoke("device-admin", {
        body: {
          action: "create_device",
          name: createForm.name,
          type: createForm.type,
          location_id: createForm.location_id,
          state: initState,
          metadata: { endpoint: "https://example.com/mock-endpoint" },
        }
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
      const { error } = await supabase.functions.invoke("device-admin", {
        body: {
          action: "update_device",
          id: editId,
          name: editForm.name,
          type: editForm.type,
          location_id: editForm.location_id,
        }
      });
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const deleteDevice = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.functions.invoke("device-admin", { body: { action: "delete_device", id } });
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Device deleted" });
      setDeleteConfirmId(null);
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  // Test Device Webhook
  const testDevice = useMutation({
    mutationFn: async (device: Device) => {
      const webhookUrl = getToggleUrl(settings);
      if (!webhookUrl) throw new Error("Set webhook URL in Settings");
      const payload = {
        source: "dashboard",
        action: "toggle",
        device_id: device.id,
        location_id: device.location_id,
        device_type: device.type,
        desired_state: device.state,
        timestamp: new Date().toISOString(),
      };
      const { error } = await supabase.functions.invoke("relay-webhook", {
        body: { url: webhookUrl, background: true, payload },
      });
      if (error) throw error;
      await supabase.from("webhook_logs").insert({
        webhook_type: "device_test",
        url: webhookUrl,
        payload,
        status: 202,
      });
    },
    onSuccess: () => toast({ title: "Test sent" }),
    onError: (e) => toast({ title: `Test failed: ${String(e)}` }),
  });

  // Test All Devices
  const testAllDevices = useMutation({
    mutationFn: async () => {
      const webhookUrl = getToggleUrl(settings);
      if (!webhookUrl) throw new Error("Set webhook URL in Settings");
      const calls = devices.map((device) => {
        const payload = {
          source: "dashboard",
          action: "toggle",
          device_id: device.id,
          location_id: device.location_id,
          device_type: device.type,
          desired_state: device.state,
          timestamp: new Date().toISOString(),
        };
        return supabase.functions.invoke("relay-webhook", {
          body: { url: webhookUrl, background: true, payload },
        });
      });
      const results = await Promise.allSettled(calls);
      const success = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - success;
      if (failed > 0) throw new Error(`${failed} failed, ${success} succeeded`);
    },
    onSuccess: () => toast({ title: "All device tests sent" }),
    onError: (e) => toast({ title: `Bulk test: ${String(e)}` }),
  });

  const webhookConfigured = !!getToggleUrl(settings);

  return (
    <main className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Devices</h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => testAllDevices.mutate()}
            disabled={!webhookConfigured || devices.length === 0}
          >
            Test All
          </Button>
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
                    {DEVICE_TYPES.map((t) => (<SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>))}
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
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Filters</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Type uses a strict enum; names are unique per location.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {DEVICE_TYPES.map((t) => (<SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>))}
          </SelectContent>
        </Select>
        <Select value={powerFilter} onValueChange={(v) => setPowerFilter(v as any)}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Power" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Power: All</SelectItem>
            <SelectItem value="on">Power: On</SelectItem>
            <SelectItem value="off">Power: Off</SelectItem>
          </SelectContent>
        </Select>
        <Select value={locationFilter} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All locations" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((l: any) => (<SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>))}
          </SelectContent>
        </Select>
        {filteredDevices.length !== devices.length && (
          <span className="text-sm text-muted-foreground">{filteredDevices.length} of {devices.length}</span>
        )}
      </div>

      {filteredDevices.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {devices.length === 0 ? "No devices yet. Add your first device." : "No devices match the current filters."}
        </div>
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDevices.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              onChange={(ns, action) => controlMutation.mutate({ id: d.id, newState: ns, action, device: d })}
              onEdit={() => {
                setEditId(d.id);
                setEditForm({ name: d.name, type: d.type, location_id: d.location_id });
                setOpenEdit(true);
              }}
              onDelete={() => setDeleteConfirmId(d.id)}
              onTest={() => testDevice.mutate(d)}
            />
          ))}
        </section>
      )}

      {/* Edit Dialog */}
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
                {DEVICE_TYPES.map((t) => (<SelectItem key={t} value={t} className="capitalize">{t.replace("_", " ")}</SelectItem>))}
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

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Device</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{devices.find((d) => d.id === deleteConfirmId)?.name}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && deleteDevice.mutate(deleteConfirmId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
