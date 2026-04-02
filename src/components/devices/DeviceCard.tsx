import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReactNode, useMemo, useState } from "react";
import { Pencil, Trash2, Send, Zap } from "lucide-react";

export type DeviceType = "light" | "fan" | "ac" | "curtain" | "geyser" | "sensor" | "smart_plug" | "ir_blaster";

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
  onTest?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

const IR_COMMANDS = ["power", "volume_up", "volume_down", "mute", "source", "cool_20", "cool_24", "cool_26"];

export function DeviceCard({ device, onChange, onTest, onEdit, onDelete }: DeviceCardProps) {
  const [localState, setLocalState] = useState<any>(device.state || {});
  const [irCommand, setIrCommand] = useState<string>("");

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

  const presets = useMemo(() => {
    switch (device.type) {
      case "light":
        return [
          { label: "Off", state: { power: false } },
          { label: "On 100%", state: { power: true, brightness: 100 } },
          { label: "Relax 50%", state: { power: true, brightness: 50 } },
        ];
      case "fan":
        return [
          { label: "Off", state: { power: false } },
          { label: "Low", state: { power: true, speed: 1 } },
          { label: "Med", state: { power: true, speed: 2 } },
          { label: "High", state: { power: true, speed: 3 } },
        ];
      case "ac":
        return [
          { label: "Off", state: { power: false } },
          { label: "Cool 22°", state: { power: true, temperature: 22 } },
          { label: "Eco 26°", state: { power: true, temperature: 26 } },
        ];
      case "curtain":
        return [
          { label: "Open", state: { position: "open" } },
          { label: "Close", state: { position: "closed" } },
        ];
      case "geyser":
        return [
          { label: "On", state: { power: true } },
          { label: "Off", state: { power: false } },
        ];
      case "smart_plug":
        return [
          { label: "On", state: { power: true } },
          { label: "Off", state: { power: false } },
        ];
      default:
        return [] as Array<{ label: string; state: any }>;
    }
  }, [device.type]);

  const typeBadge = (
    <Badge variant="secondary" className="capitalize">{device.type.replace("_", " ")}</Badge>
  );

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">{device.name}</CardTitle>
            {device.location?.name && (
              <p className="text-xs text-muted-foreground">{device.location?.name}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {typeBadge}
            {onTest && (
              <Button variant="secondary" size="sm" onClick={onTest} aria-label={`Test ${device.name}`}>
                <Send className="h-4 w-4" />
              </Button>
            )}
            {onEdit && (
              <Button variant="secondary" size="sm" onClick={onEdit} aria-label={`Edit ${device.name}`}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button variant="destructive" size="sm" onClick={onDelete} aria-label={`Delete ${device.name}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
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
              "Speed (0–3)",
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
              "Temperature (°C)",
              <Input
                type="number"
                className="w-24"
                min={16}
                max={32}
                value={Number(localState.temperature ?? 24)}
                onChange={(e) => commit({ ...localState, temperature: Number(e.target.value) })}
              />
            )}
          </>
        )}

        {device.type === "curtain" && (
          <div className="flex items-center gap-2">
            <Button
              variant={localState.position === "open" ? "default" : "secondary"}
              onClick={() => commit({ ...localState, position: "open" }, "open")}
            >
              Open
            </Button>
            <Button
              variant={localState.position === "closed" ? "default" : "secondary"}
              onClick={() => commit({ ...localState, position: "closed" }, "close")}
            >
              Close
            </Button>
            {localState.position && (
              <span className="text-sm text-muted-foreground capitalize ml-2">{localState.position}</span>
            )}
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

        {device.type === "smart_plug" && (
          <>
            {row(
              "Power",
              <Switch
                checked={!!localState.power}
                onCheckedChange={(v) => commit({ ...localState, power: v })}
              />
            )}
            {localState.energy_wh !== undefined && (
              <div className="text-xs text-muted-foreground">Energy: {localState.energy_wh} Wh</div>
            )}
          </>
        )}

        {device.type === "ir_blaster" && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Last command: <span className="font-medium">{localState.last_command ?? "—"}</span>
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Command (e.g. power)"
                value={irCommand}
                onChange={(e) => setIrCommand(e.target.value)}
                className="text-sm"
                list="ir-commands"
              />
              <datalist id="ir-commands">
                {IR_COMMANDS.map((c) => <option key={c} value={c} />)}
              </datalist>
              <Button
                size="sm"
                disabled={!irCommand.trim()}
                onClick={() => {
                  const cmd = irCommand.trim();
                  commit({ ...localState, last_command: cmd }, `ir_send:${cmd}`);
                  setIrCommand("");
                }}
              >
                <Zap className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {IR_COMMANDS.slice(0, 5).map((cmd) => (
                <Button
                  key={cmd}
                  size="sm"
                  variant="outline"
                  className="text-xs h-7"
                  onClick={() => commit({ ...localState, last_command: cmd }, `ir_send:${cmd}`)}
                >
                  {cmd}
                </Button>
              ))}
            </div>
          </div>
        )}

        {device.type === "sensor" && (
          <div className="space-y-1">
            <div className="text-sm text-muted-foreground">
              Last seen: {device.last_seen ? new Date(device.last_seen).toLocaleString() : "—"}
            </div>
            {Object.entries(localState).map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-muted-foreground capitalize">{k.replace("_", " ")}</span>
                <span className="font-medium">{String(v)}</span>
              </div>
            ))}
          </div>
        )}

        {presets.length > 0 && (
          <div className="pt-2">
            <div className="text-xs text-muted-foreground mb-1">Presets</div>
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <Button
                  key={p.label}
                  size="sm"
                  variant="secondary"
                  onClick={() => commit({ ...localState, ...p.state }, `preset:${p.label}`)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
