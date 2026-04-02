import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/useRealtime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useMemo } from "react";

async function fetchLocations() {
  const { data, error } = await supabase.from("locations").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

async function fetchScenes() {
  const { data, error } = await supabase
    .from("scenes")
    .select("id,name,location_id, actions:scene_actions(id,device_id,desired_state, device:devices(name,location_id))")
    .order("name");
  if (error) throw error;
  return data || [];
}

async function fetchDevices() {
  const { data, error } = await supabase.from("devices").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

async function fetchSettings() {
  const { data, error } = await supabase
    .from("app_settings")
    .select("id,webhook_url,scene_activate_webhook_url")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function getSceneWebhookUrl(settings: any): string | null {
  return settings?.scene_activate_webhook_url || settings?.webhook_url || null;
}

export default function ScenesPage() {
  const qc = useQueryClient();
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const { data: devices = [] } = useQuery({ queryKey: ["devices-min"], queryFn: fetchDevices });
  const { data: scenes = [] } = useQuery({ queryKey: ["scenes"], queryFn: fetchScenes });
  const { data: settings } = useQuery({ queryKey: ["app_settings"], queryFn: fetchSettings });

  useRealtimeTables(["scenes", "scene_actions"], () => qc.invalidateQueries({ queryKey: ["scenes"] }));

  const [openCreate, setOpenCreate] = useState(false);
  const [newScene, setNewScene] = useState<{ name: string; location_id?: string }>({ name: "" });

  const createScene = useMutation({
    mutationFn: async (payload: { name: string; location_id: string }) => {
      const { error } = await supabase.from("scenes").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Scene created" });
      setOpenCreate(false);
      setNewScene({ name: "" });
      qc.invalidateQueries({ queryKey: ["scenes"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  const addAction = useMutation({
    mutationFn: async (payload: { scene_id: string; device_id: string; desired_state: any }) => {
      const { error } = await supabase.from("scene_actions").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Action added" });
      qc.invalidateQueries({ queryKey: ["scenes"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  const activateScene = useMutation({
    mutationFn: async (scene: any) => {
      for (const act of scene.actions || []) {
        await supabase.from("devices").update({ state: act.desired_state, last_seen: new Date().toISOString() }).eq("id", act.device_id);
        await supabase.from("sensor_events").insert({ device_id: act.device_id, event_type: "scene_applied", value: act.desired_state });
      }

      const webhookUrl = getSceneWebhookUrl(settings);
      if (webhookUrl) {
        const payload = {
          source: "dashboard",
          action: "activate_scene",
          scene_id: scene.id,
          location_id: scene.location_id,
          desired_state: scene.actions?.reduce((acc: any, a: any) => ({ ...acc, [a.device_id]: a.desired_state }), {}),
          timestamp: new Date().toISOString(),
        };
        supabase.functions.invoke("relay-webhook", { body: { url: webhookUrl, background: true, payload } });
        supabase.from("webhook_logs").insert({
          webhook_type: "scene_activation",
          url: webhookUrl,
          payload,
          status: 202,
        });
      }
    },
    onSuccess: () => {
      toast({ title: "Scene activated" });
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  const bulkActivate = useMutation({
    mutationFn: async (scenesToActivate: any[]) => {
      for (const scene of scenesToActivate) {
        for (const act of scene.actions || []) {
          await supabase.from("devices").update({ state: act.desired_state, last_seen: new Date().toISOString() }).eq("id", act.device_id);
          await supabase.from("sensor_events").insert({ device_id: act.device_id, event_type: "scene_applied", value: act.desired_state });
        }
      }
      const webhookUrl = getSceneWebhookUrl(settings);
      if (webhookUrl) {
        const payload = {
          source: "dashboard",
          action: "activate_scene",
          scene_id: scenesToActivate.map((s: any) => s.id),
          desired_state: {},
          timestamp: new Date().toISOString(),
        };
        supabase.functions.invoke("relay-webhook", { body: { url: webhookUrl, background: true, payload } });
        supabase.from("webhook_logs").insert({
          webhook_type: "scene_activation",
          url: webhookUrl,
          payload,
          status: 202,
        });
      }
    },
    onSuccess: () => {
      toast({ title: "Activated selected scenes" });
      qc.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [editScene, setEditScene] = useState<any>(null);

  const updateScene = useMutation({
    mutationFn: async ({ id, name, location_id }: { id: string; name: string; location_id: string }) => {
      const { error } = await supabase.from("scenes").update({ name, location_id }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Scene updated" }); qc.invalidateQueries({ queryKey: ["scenes"] }); setEditOpen(false); },
    onError: (e) => toast({ title: String(e) }),
  });

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const deleteScene = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("scenes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Scene deleted" });
      setDeleteConfirmId(null);
      qc.invalidateQueries({ queryKey: ["scenes"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  const deleteAction = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("scene_actions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast({ title: "Action removed" }); qc.invalidateQueries({ queryKey: ["scenes"] }); },
    onError: (e) => toast({ title: String(e) }),
  });

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([id]) => id), [selected]);

  return (
    <main className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Scenes</h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={!selectedIds.length}
            onClick={() => bulkActivate.mutate(scenes.filter((s: any) => selectedIds.includes(s.id)))}
          >
            Activate Selected ({selectedIds.length})
          </Button>
          <Dialog open={openCreate} onOpenChange={setOpenCreate}>
            <DialogTrigger asChild>
              <Button>Create Scene</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Scene</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Input placeholder="Scene name" value={newScene.name} onChange={(e) => setNewScene((s) => ({ ...s, name: e.target.value }))} />
                <Select onValueChange={(v) => setNewScene((s) => ({ ...s, location_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {(locations as any[]).map((l: any) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button disabled={!newScene.name || !newScene.location_id} onClick={() => createScene.mutate(newScene as any)}>Create</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {(scenes as any[]).length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">No scenes yet. Create your first scene.</div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(scenes as any[]).map((s: any) => (
            <Card key={s.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={!!selected[s.id]}
                      onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [s.id]: !!v }))}
                    />
                    <CardTitle className="text-base">{s.name}</CardTitle>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { setEditScene(s); setEditOpen(true); }}>Edit</Button>
                    <Button size="sm" variant="destructive" onClick={() => setDeleteConfirmId(s.id)}>Delete</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="text-sm text-muted-foreground">{s.actions?.length || 0} action{s.actions?.length !== 1 ? "s" : ""}</div>
                <div className="space-y-2">
                  {(s.actions || []).map((a: any) => (
                    <div key={a.id} className="flex items-center justify-between text-sm gap-2">
                      <div className="min-w-0">
                        <span className="font-medium">{a.device?.name || a.device_id}:</span>{" "}
                        <span className="text-muted-foreground text-xs">{JSON.stringify(a.desired_state)}</span>
                      </div>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive shrink-0" onClick={() => deleteAction.mutate(a.id)}>Remove</Button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="secondary" size="sm">Add Action</Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Action to "{s.name}"</DialogTitle>
                      </DialogHeader>
                      <AddActionForm sceneId={s.id} devices={devices} onSave={(payload) => addAction.mutate(payload)} />
                    </DialogContent>
                  </Dialog>
                  <Button size="sm" onClick={() => activateScene.mutate(s)} disabled={!s.actions?.length}>
                    Activate
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Scene</DialogTitle>
          </DialogHeader>
          {editScene && (
            <div className="space-y-3">
              <Input value={editScene.name} onChange={(e) => setEditScene({ ...editScene, name: e.target.value })} />
              <Select value={editScene.location_id} onValueChange={(v) => setEditScene({ ...editScene, location_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {(locations as any[]).map((l: any) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => updateScene.mutate({ id: editScene.id, name: editScene.name, location_id: editScene.location_id })} disabled={!editScene?.name || !editScene?.location_id}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => { if (!open) setDeleteConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Scene</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete <strong>{(scenes as any[]).find((s: any) => s.id === deleteConfirmId)?.name}</strong>? All actions will also be removed.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirmId && deleteScene.mutate(deleteConfirmId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function AddActionForm({ sceneId, devices, onSave }: { sceneId: string; devices: any[]; onSave: (p: { scene_id: string; device_id: string; desired_state: any }) => void }) {
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [json, setJson] = useState("{\n  \"power\": true\n}");

  return (
    <div className="space-y-3">
      <Select onValueChange={setDeviceId}>
        <SelectTrigger><SelectValue placeholder="Select device" /></SelectTrigger>
        <SelectContent>
          {devices.map((d: any) => (
            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div>
        <label className="text-sm font-medium">Desired State (JSON)</label>
        <textarea className="w-full min-h-32 rounded-md border bg-background p-2 text-sm font-mono" value={json} onChange={(e) => setJson(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button
          disabled={!deviceId}
          onClick={() => {
            try {
              const desired = JSON.parse(json);
              onSave({ scene_id: sceneId, device_id: deviceId!, desired_state: desired });
            } catch {
              toast({ title: "Invalid JSON" });
            }
          }}
        >
          Save Action
        </Button>
      </div>
    </div>
  );
}
