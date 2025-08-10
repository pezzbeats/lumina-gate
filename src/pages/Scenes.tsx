import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/useRealtime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { useState } from "react";

async function fetchLocations() {
  const { data, error } = await supabase.from("locations").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

async function fetchScenes() {
  const { data, error } = await supabase
    .from("scenes")
    .select("id,name,location_id, actions:scene_actions(id,device_id,desired_state)")
    .order("name");
  if (error) throw error;
  return data || [];
}

async function fetchDevices() {
  const { data, error } = await supabase.from("devices").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

export default function ScenesPage() {
  const qc = useQueryClient();
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  const { data: devices = [] } = useQuery({ queryKey: ["devices-min"], queryFn: fetchDevices });
  const { data: scenes = [] } = useQuery({ queryKey: ["scenes"], queryFn: fetchScenes });
  const { data: settings } = useQuery({ queryKey: ["app_settings"], queryFn: async () => (await supabase.from("app_settings").select("id,webhook_url").limit(1).maybeSingle()).data });

  useRealtimeTables(["scenes", "scene_actions"], () => qc.invalidateQueries({ queryKey: ["scenes"] }));

  const [openCreate, setOpenCreate] = useState(false);
  const [newScene, setNewScene] = useState<{ name: string; location_id?: string }>({ name: "" });

  const createScene = useMutation({
    mutationFn: async (payload: { name: string; location_id: string }) => {
      const { error } = await supabase.from("scenes").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Scene created");
      setOpenCreate(false);
      setNewScene({ name: "" });
      qc.invalidateQueries({ queryKey: ["scenes"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const addAction = useMutation({
    mutationFn: async (payload: { scene_id: string; device_id: string; desired_state: any }) => {
      const { error } = await supabase.from("scene_actions").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Action added");
      qc.invalidateQueries({ queryKey: ["scenes"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const activateScene = useMutation({
    mutationFn: async (scene: any) => {
      // Update devices based on scene actions
      for (const act of scene.actions || []) {
        await supabase.from("devices").update({ state: act.desired_state, last_seen: new Date().toISOString() }).eq("id", act.device_id);
        await supabase.from("sensor_events").insert({ device_id: act.device_id, event_type: "scene_applied", value: act.desired_state });
      }

      if (settings?.webhook_url) {
        await supabase.functions.invoke("relay-webhook", {
          body: {
            url: settings.webhook_url,
            payload: { type: "scene_activation", scene_id: scene.id, actions: scene.actions },
          },
        });
      }
    },
    onSuccess: () => toast.success("Scene activated"),
    onError: (e) => toast.error(String(e)),
  });

  return (
    <main className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Scenes</h1>
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
                  {locations.map((l: any) => (
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

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {scenes.map((s: any) => (
          <Card key={s.id}>
            <CardHeader>
              <CardTitle>{s.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">Actions: {s.actions?.length || 0}</div>
              <div className="flex flex-wrap gap-2">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="secondary">Add Action</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Add Action</DialogTitle>
                    </DialogHeader>
                    <AddActionForm sceneId={s.id} devices={devices} onSave={(payload) => addAction.mutate(payload)} />
                  </DialogContent>
                </Dialog>
                <Button onClick={() => activateScene.mutate(s)}>Activate</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}

function AddActionForm({ sceneId, devices, onSave }: { sceneId: string; devices: any[]; onSave: (p: { scene_id: string; device_id: string; desired_state: any }) => void }) {
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [json, setJson] = useState(`{
  \"power\": true
}`);

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
      <textarea className="w-full min-h-32 rounded-md border bg-background p-2 text-sm" value={json} onChange={(e) => setJson(e.target.value)} />
      <div className="flex justify-end">
        <Button
          disabled={!deviceId}
          onClick={() => {
            try {
              const desired = JSON.parse(json);
              onSave({ scene_id: sceneId, device_id: deviceId!, desired_state: desired });
            } catch {
              toast.error("Invalid JSON");
            }
          }}
        >
          Save Action
        </Button>
      </div>
    </div>
  );
}
