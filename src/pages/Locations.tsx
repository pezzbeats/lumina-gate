import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeTables } from "@/hooks/useRealtime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { useState } from "react";

async function fetchLocations() {
  const { data, error } = await supabase.from("locations").select("id,name").order("name");
  if (error) throw error;
  return data || [];
}

export default function LocationsPage() {
  const qc = useQueryClient();
  const { data: locations = [] } = useQuery({ queryKey: ["locations"], queryFn: fetchLocations });
  useRealtimeTables(["locations"], () => qc.invalidateQueries({ queryKey: ["locations"] }));

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const create = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("locations").insert({ name });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Location created");
      setOpen(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["locations"] });
    },
    onError: (e) => toast.error(String(e)),
  });

  const update = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("locations").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
    onError: (e) => toast.error(String(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("locations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
    onError: (e) => toast.error(String(e)),
  });

  return (
    <main className="container py-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Locations</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>Add Location</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Location</DialogTitle>
            </DialogHeader>
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <DialogFooter>
              <Button disabled={!name} onClick={() => create.mutate(name)}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <section className="grid gap-3">
        {locations.map((l: any) => (
          <Card key={l.id}>
            <CardContent className="py-3 flex items-center justify-between gap-3">
              <Input className="max-w-sm" defaultValue={l.name} onBlur={(e) => update.mutate({ id: l.id, name: e.target.value })} />
              <Button variant="destructive" onClick={() => remove.mutate(l.id)}>Delete</Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
}
