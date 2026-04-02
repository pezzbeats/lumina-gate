import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/useRealtime";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import { Send, RefreshCw, Trash2, Download } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface WebhookUrls {
  device_toggle_webhook_url: string;
  scene_activate_webhook_url: string;
  sensor_event_webhook_url: string;
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

async function fetchLogs() {
  const { data, error } = await supabase
    .from("webhook_logs")
    .select("id,webhook_type,url,status,duration_ms,error,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings } = useQuery({ queryKey: ["app_settings"], queryFn: fetchSettings });
  const { data: logs = [] } = useQuery({ queryKey: ["webhook_logs"], queryFn: fetchLogs });

  useRealtimeTables(["webhook_logs"], () => qc.invalidateQueries({ queryKey: ["webhook_logs"] }));

  const [urls, setUrls] = useState<WebhookUrls>({
    device_toggle_webhook_url: "",
    scene_activate_webhook_url: "",
    sensor_event_webhook_url: "",
  });

  useEffect(() => {
    if (!settings) return;
    const fallback = settings.webhook_url || "";
    setUrls({
      device_toggle_webhook_url: settings.device_toggle_webhook_url || fallback,
      scene_activate_webhook_url: settings.scene_activate_webhook_url || fallback,
      sensor_event_webhook_url: settings.sensor_event_webhook_url || fallback,
    });
  }, [JSON.stringify(settings)]);

  const save = useMutation({
    mutationFn: async () => {
      if (settings?.id) {
        const { error } = await supabase.from("app_settings").update(urls).eq("id", settings.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("app_settings").insert(urls);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Settings saved" });
      qc.invalidateQueries({ queryKey: ["app_settings"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  const testWebhook = useMutation({
    mutationFn: async (type: keyof WebhookUrls) => {
      const url = urls[type];
      if (!url) throw new Error("Please enter a URL for this webhook");
      const start = Date.now();
      const payload = {
        source: "dashboard",
        action: "test",
        webhook_type: type,
        timestamp: new Date().toISOString(),
        message: "Test from Lumina Gate Settings",
      };
      // Use background:false so relay-webhook waits and returns n8n's real status
      const { data: relayData, error } = await supabase.functions.invoke("relay-webhook", {
        body: { url, background: false, payload },
      });
      const duration_ms = Date.now() - start;
      // relayData contains { ok, status, statusText, body } from the real upstream response
      const upstreamStatus: number = error ? 500 : (relayData?.status ?? 200);
      await supabase.from("webhook_logs").insert({
        webhook_type: type,
        url,
        payload,
        status: upstreamStatus,
        duration_ms,
        error: error ? String(error) : (relayData?.ok === false ? relayData?.body : null),
      });
      if (error) throw error;
      if (relayData?.ok === false) throw new Error(`Upstream returned ${upstreamStatus}: ${relayData?.body}`);
    },
    onSuccess: () => toast({ title: "Webhook test sent — check logs below" }),
    onError: (e) => toast({ title: `Test failed: ${String(e)}` }),
  });

  const [clearConfirm, setClearConfirm] = useState(false);
  const clearLogs = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("webhook_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Logs cleared" });
      setClearConfirm(false);
      qc.invalidateQueries({ queryKey: ["webhook_logs"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  const WEBHOOK_FIELDS: { key: keyof WebhookUrls; label: string; description: string }[] = [
    {
      key: "device_toggle_webhook_url",
      label: "Device Toggle Webhook",
      description: "Called when a device state is updated (toggle, slider, preset).",
    },
    {
      key: "scene_activate_webhook_url",
      label: "Scene Activation Webhook",
      description: "Called when a scene is activated (single or bulk).",
    },
    {
      key: "sensor_event_webhook_url",
      label: "Sensor Event Webhook",
      description: "Called when a sensor event is simulated or triggered.",
    },
  ];

  return (
    <main className="container py-6 space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {/* n8n Workflow Download */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">n8n Master Controller Workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Download the pre-built n8n workflow that receives all events from this app and routes them by action type (device toggle, scene activation, sensor event). Import it directly into n8n to get started.
          </p>
          <div className="rounded-md border bg-muted/40 p-3 text-xs font-mono text-muted-foreground space-y-1">
            <div>POST /webhook/home-automation</div>
            <div>→ toggle → Handle Device Toggle</div>
            <div>→ activate_scene → Handle Scene</div>
            <div>→ sensor_event → Handle Sensor</div>
            <div>→ test → Handle Test</div>
            <div>→ * → Fallback Unknown</div>
          </div>
          <a href="/n8n-master-controller.json" download="n8n-master-controller.json">
            <Button variant="secondary">
              <Download className="h-4 w-4 mr-2" />
              Download n8n Workflow JSON
            </Button>
          </a>
        </CardContent>
      </Card>

      {/* Webhook Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Webhook Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {WEBHOOK_FIELDS.map(({ key, label, description }) => (
            <div key={key} className="space-y-2">
              <label className="text-sm font-medium">{label}</label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://your-n8n-or-webhook-url"
                  value={urls[key]}
                  onChange={(e) => setUrls((u) => ({ ...u, [key]: e.target.value }))}
                />
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={() => testWebhook.mutate(key)}
                  disabled={!urls[key] || testWebhook.isPending}
                  title="Test this webhook"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
          ))}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save Settings
          </Button>
        </CardContent>
      </Card>

      {/* Webhook Logs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Recent Webhook Logs</CardTitle>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => qc.invalidateQueries({ queryKey: ["webhook_logs"] })}
                title="Refresh logs"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              {logs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setClearConfirm(true)}
                  title="Clear all logs"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No webhook logs yet. Logs appear here when webhooks are sent.</p>
          ) : (
            <div className="space-y-2">
              {logs.map((log: any) => (
                <div key={log.id} className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm">
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium capitalize">{log.webhook_type.replace(/_/g, " ")}</span>
                      {log.duration_ms != null && (
                        <span className="text-xs text-muted-foreground">{log.duration_ms}ms</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-sm">{log.url || "—"}</div>
                    {log.error && (
                      <div className="text-xs text-destructive truncate max-w-sm">{log.error}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <StatusBadge status={log.status} />
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Clear Confirm Dialog */}
      <Dialog open={clearConfirm} onOpenChange={setClearConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Webhook Logs</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete all {logs.length} webhook log entries. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setClearConfirm(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => clearLogs.mutate()} disabled={clearLogs.isPending}>
              Clear All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function StatusBadge({ status }: { status: number | null }) {
  if (status == null) return <Badge variant="secondary">—</Badge>;
  if (status >= 200 && status < 300) return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{status}</Badge>;
  if (status >= 400) return <Badge variant="destructive">{status}</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}
