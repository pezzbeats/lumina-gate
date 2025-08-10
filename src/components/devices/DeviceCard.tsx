import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReactNode, useMemo, useState } from "react";

export type DeviceType = "light" | "fan" | "ac" | "curtain" | "geyser" | "sensor";

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  location_id: string;
  state: any;
  metadata: any;
  last_seen: string | null;
  location?: { id: string; name: string } | null;
}

export interface DeviceCardProps {
  device: Device;
  onChange: (newState: any, action: string) => void;
}

export function DeviceCard({ device, onChange }: DeviceCardProps) {
  const [localState, setLocalState] = useState<any>(device.state || {});

  // Keep local state in sync if parent updates via realtime
  useMemo(() => setLocalState(device.state || {}), [JSON.stringify(device.state)]);

  const row = (label: string, control: ReactNode) => (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3">{control}</div>
    </div>
  );

  const commit = (newState: any, action = "update_state") => {
    setLocalState(newState);
    onChange(newState, action);
  };

  const typeBadge = (
    <Badge variant="secondary" className="capitalize">{device.type}</Badge>
  );

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{device.name}</CardTitle>
          {typeBadge}
        </div>
        {device.location?.name && (
          <p className="text-xs text-muted-foreground">{device.location?.name}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {device.type === "light" && (
          <>
            {row(
              "Power",
              <Switch
                checked={!!localState.power}
                onCheckedChange={(v) => commit({ ...localState, power: v })}
              />
            )}
            {row(
              "Brightness",
              <Slider
                value={[Number(localState.brightness ?? 50)]}
                min={0}
                max={100}
                step={1}
                onValueChange={([v]) => commit({ ...localState, brightness: v })}
                className="w-40"
              />
            )}
          </>
        )}

        {device.type === "fan" && (
          <>
            {row(
              "Power",
              <Switch
                checked={!!localState.power}
                onCheckedChange={(v) => commit({ ...localState, power: v })}
              />
            )}
            {row(
              "Speed",
              <Slider
                value={[Number(localState.speed ?? 1)]}
                min={0}
                max={3}
                step={1}
                onValueChange={([v]) => commit({ ...localState, speed: v })}
                className="w-40"
              />
            )}
          </>
        )}

        {device.type === "ac" && (
          <>
            {row(
              "Power",
              <Switch
                checked={!!localState.power}
                onCheckedChange={(v) => commit({ ...localState, power: v })}
              />
            )}
            {row(
              "Temperature",
              <Input
                type="number"
                className="w-24"
                value={Number(localState.temperature ?? 24)}
                onChange={(e) => commit({ ...localState, temperature: Number(e.target.value) })}
              />
            )}
          </>
        )}

        {device.type === "curtain" && (
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => commit({ ...localState, position: "open" }, "open")}>Open</Button>
            <Button variant="secondary" onClick={() => commit({ ...localState, position: "closed" }, "close")}>Close</Button>
          </div>
        )}

        {device.type === "geyser" && (
          row(
            "Power",
            <Switch
              checked={!!localState.power}
              onCheckedChange={(v) => commit({ ...localState, power: v })}
            />
          )
        )}

        {device.type === "sensor" && (
          <div className="text-sm text-muted-foreground break-words">
            Last seen: {device.last_seen ? new Date(device.last_seen).toLocaleString() : "-"}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
