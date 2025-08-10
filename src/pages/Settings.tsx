import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["app_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_settings").select("id,webhook_url").limit(1).maybeSingle();
      if (error) throw error;
      return data || null;
    },
  });

  const [webhook, setWebhook] = useState<string>(data?.webhook_url || "");

  const save = useMutation({
    mutationFn: async (url: string) => {
      if (data?.id) {
        const { error } = await supabase.from("app_settings").update({ webhook_url: url }).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("app_settings").insert({ webhook_url: url });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: "Settings saved" });
      qc.invalidateQueries({ queryKey: ["app_settings"] });
    },
    onError: (e) => toast({ title: String(e) }),
  });

  return (
    <main className="container py-6 space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardContent className="py-6 space-y-3">
          <label className="text-sm font-medium">n8n/Webhook URL</label>
          <Input placeholder="https://webhook.site/.. or your n8n webhook" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
          <div className="text-sm text-muted-foreground">All device actions and scene activations will be relayed to this URL through a Supabase Edge Function. Replace this with your real orchestrator later.</div>
          <div>
            <Button onClick={() => save.mutate(webhook)} disabled={!webhook}>Save</Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
