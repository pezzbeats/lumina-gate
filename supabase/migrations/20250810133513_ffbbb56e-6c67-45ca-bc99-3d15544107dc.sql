-- Create core tables
-- Note: Using UUIDs and JSONB for flexible device state/metadata

-- Helper function for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Locations
CREATE TABLE IF NOT EXISTS public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Devices
CREATE TABLE IF NOT EXISTS public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('light','fan','ac','curtain','geyser','sensor')),
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sensor events
CREATE TABLE IF NOT EXISTS public.sensor_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scenes
CREATE TABLE IF NOT EXISTS public.scenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Scene actions
CREATE TABLE IF NOT EXISTS public.scene_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_id UUID NOT NULL REFERENCES public.scenes(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  desired_state JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- App settings (singleton row expected)
CREATE TABLE IF NOT EXISTS public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Triggers for updated_at
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_locations_updated_at'
  ) THEN
    CREATE TRIGGER trg_locations_updated_at
    BEFORE UPDATE ON public.locations
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_devices_updated_at'
  ) THEN
    CREATE TRIGGER trg_devices_updated_at
    BEFORE UPDATE ON public.devices
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_scenes_updated_at'
  ) THEN
    CREATE TRIGGER trg_scenes_updated_at
    BEFORE UPDATE ON public.scenes
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_app_settings_updated_at'
  ) THEN
    CREATE TRIGGER trg_app_settings_updated_at
    BEFORE UPDATE ON public.app_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Enable RLS and open policies for public demo (can be tightened later)
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sensor_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scene_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Policies: allow all (public demo)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'locations_all') THEN
    CREATE POLICY "locations_all" ON public.locations FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'devices_all') THEN
    CREATE POLICY "devices_all" ON public.devices FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'sensor_events_all') THEN
    CREATE POLICY "sensor_events_all" ON public.sensor_events FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'scenes_all') THEN
    CREATE POLICY "scenes_all" ON public.scenes FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'scene_actions_all') THEN
    CREATE POLICY "scene_actions_all" ON public.scene_actions FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'app_settings_all') THEN
    CREATE POLICY "app_settings_all" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Realtime setup: replica identity + publication
ALTER TABLE public.locations REPLICA IDENTITY FULL;
ALTER TABLE public.devices REPLICA IDENTITY FULL;
ALTER TABLE public.sensor_events REPLICA IDENTITY FULL;
ALTER TABLE public.scenes REPLICA IDENTITY FULL;
ALTER TABLE public.scene_actions REPLICA IDENTITY FULL;
ALTER TABLE public.app_settings REPLICA IDENTITY FULL;

-- Add tables to supabase_realtime publication if not already present
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'locations';
  IF NOT FOUND THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.locations;
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'devices';
  IF NOT FOUND THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sensor_events';
  IF NOT FOUND THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sensor_events;
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'scenes';
  IF NOT FOUND THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scenes;
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'scene_actions';
  IF NOT FOUND THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.scene_actions;
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_settings';
  IF NOT FOUND THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_settings;
  END IF;
END $$;

-- Seed initial data if empty
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.locations) THEN
    INSERT INTO public.locations (name) VALUES ('Home'), ('Office');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.devices) THEN
    -- Fetch ids for seeded locations
    WITH locs AS (
      SELECT id, name FROM public.locations
    )
    INSERT INTO public.devices (name, type, location_id, state, metadata, last_seen)
    VALUES
      ('Living Room Light', 'light', (SELECT id FROM locs WHERE name='Home'), '{"power": true, "brightness": 80}'::jsonb, '{"endpoint": "https://example.com/devices/living-light"}'::jsonb, now()),
      ('Bedroom Fan', 'fan', (SELECT id FROM locs WHERE name='Home'), '{"power": false, "speed": 2}'::jsonb, '{"endpoint": "https://example.com/devices/bedroom-fan"}'::jsonb, now()),
      ('Office AC', 'ac', (SELECT id FROM locs WHERE name='Office'), '{"power": true, "temperature": 24}'::jsonb, '{"endpoint": "https://example.com/devices/office-ac"}'::jsonb, now()),
      ('Home Curtains', 'curtain', (SELECT id FROM locs WHERE name='Home'), '{"position": "closed"}'::jsonb, '{"endpoint": "https://example.com/devices/home-curtains"}'::jsonb, now()),
      ('Water Geyser', 'geyser', (SELECT id FROM locs WHERE name='Home'), '{"power": false}'::jsonb, '{"endpoint": "https://example.com/devices/water-geyser"}'::jsonb, now());
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings) THEN
    INSERT INTO public.app_settings (webhook_url) VALUES ('https://webhook.site/your-temp-id');
  END IF;
END $$;
