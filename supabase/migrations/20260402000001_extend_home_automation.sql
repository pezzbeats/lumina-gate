-- =========================================================
-- Extension migration: Home Automation full feature set
-- Adds: webhook_logs, extends app_settings, new device types,
--       RPC get_scene_actions, and seeds comprehensive mock data
-- =========================================================

-- 1. Add new device types to enum (safe, IF NOT EXISTS equivalent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'smart_plug'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'device_type')
  ) THEN
    ALTER TYPE device_type ADD VALUE 'smart_plug';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'ir_blaster'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'device_type')
  ) THEN
    ALTER TYPE device_type ADD VALUE 'ir_blaster';
  END IF;
END $$;

-- 2. Extend app_settings with per-action webhook URLs
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS device_toggle_webhook_url  text,
  ADD COLUMN IF NOT EXISTS scene_activate_webhook_url text,
  ADD COLUMN IF NOT EXISTS sensor_event_webhook_url   text;

-- Backfill the three new columns from the existing single webhook_url
UPDATE app_settings
SET
  device_toggle_webhook_url  = COALESCE(device_toggle_webhook_url, webhook_url),
  scene_activate_webhook_url = COALESCE(scene_activate_webhook_url, webhook_url),
  sensor_event_webhook_url   = COALESCE(sensor_event_webhook_url, webhook_url)
WHERE webhook_url IS NOT NULL;

-- 3. Create webhook_logs table
CREATE TABLE IF NOT EXISTS webhook_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_type text        NOT NULL,
  url          text,
  payload      jsonb,
  status       integer,
  duration_ms  integer,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Index for recent-first log browsing
CREATE INDEX IF NOT EXISTS ix_webhook_logs_created
  ON webhook_logs (created_at DESC);

-- RLS
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'webhook_logs' AND policyname = 'allow_read_webhook_logs'
  ) THEN
    CREATE POLICY allow_read_webhook_logs ON webhook_logs FOR SELECT USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'webhook_logs' AND policyname = 'allow_insert_webhook_logs'
  ) THEN
    CREATE POLICY allow_insert_webhook_logs ON webhook_logs FOR INSERT WITH CHECK (true);
  END IF;
END $$;

-- Realtime
ALTER TABLE webhook_logs REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'webhook_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE webhook_logs;
  END IF;
END $$;

-- 4. RPC: get_scene_actions
CREATE OR REPLACE FUNCTION get_scene_actions(p_scene_id uuid)
RETURNS TABLE (
  id            uuid,
  device_id     uuid,
  desired_state jsonb,
  device_name   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    sa.id,
    sa.device_id,
    sa.desired_state::jsonb,
    d.name AS device_name
  FROM public.scene_actions sa
  JOIN public.devices d ON d.id = sa.device_id
  WHERE sa.scene_id = p_scene_id
  ORDER BY sa.id;
$$;

-- 5. updated_at trigger for webhook_logs (none needed — append-only log)

-- 6. Seed comprehensive mock data (skip if data already present)
DO $$
DECLARE
  v_home_id   uuid;
  v_office_id uuid;
  v_loc_count int;
  v_dev_count int;
  v_scene_count int;
BEGIN
  SELECT COUNT(*) INTO v_loc_count FROM public.locations;

  -- Only seed if database looks empty / minimal (≤ 2 locations and ≤ 5 devices)
  SELECT COUNT(*) INTO v_dev_count FROM public.devices;
  SELECT COUNT(*) INTO v_scene_count FROM public.scenes;

  IF v_dev_count <= 5 THEN

    -- Ensure Home & Office locations exist
    INSERT INTO public.locations (name)
    VALUES ('Home'), ('Office')
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_home_id   FROM public.locations WHERE name = 'Home'   LIMIT 1;
    SELECT id INTO v_office_id FROM public.locations WHERE name = 'Office' LIMIT 1;

    -- Home devices
    INSERT INTO public.devices (name, type, location_id, state, metadata) VALUES
      ('Living Room Light', 'light',     v_home_id,   '{"power": false, "brightness": 80}'::jsonb,  '{"mock": true}'::jsonb),
      ('Bedroom Fan',       'fan',        v_home_id,   '{"power": false, "speed": 1}'::jsonb,         '{"mock": true}'::jsonb),
      ('Curtains',          'curtain',    v_home_id,   '{"position": "closed"}'::jsonb,               '{"mock": true}'::jsonb),
      ('Geyser',            'geyser',     v_home_id,   '{"power": false}'::jsonb,                     '{"mock": true}'::jsonb),
      ('Smart Plug',        'smart_plug', v_home_id,   '{"power": false}'::jsonb,                     '{"mock": true}'::jsonb),
      ('Motion Sensor',     'sensor',     v_home_id,   '{"motion": false}'::jsonb,                    '{"mock": true}'::jsonb),
      ('Temperature Sensor','sensor',     v_home_id,   '{"temperature": 22.5, "humidity": 55}'::jsonb,'{"mock": true}'::jsonb),
      ('IR Blaster',        'ir_blaster', v_home_id,   '{"last_command": null}'::jsonb,               '{"mock": true}'::jsonb)
    ON CONFLICT DO NOTHING;

    -- Office devices
    INSERT INTO public.devices (name, type, location_id, state, metadata) VALUES
      ('Office AC',         'ac',         v_office_id, '{"power": false, "temperature": 24}'::jsonb,  '{"mock": true}'::jsonb)
    ON CONFLICT DO NOTHING;

    -- Seed scenes if missing
    IF v_scene_count = 0 THEN
      WITH ins_scenes AS (
        INSERT INTO public.scenes (name, location_id) VALUES
          ('Good Morning', v_home_id),
          ('Good Night',   v_home_id),
          ('Away Mode',    v_home_id)
        RETURNING id, name
      )
      -- Scene actions for Good Morning
      INSERT INTO public.scene_actions (scene_id, device_id, desired_state)
      SELECT
        s.id,
        d.id,
        CASE d.type
          WHEN 'light'   THEN '{"power": true, "brightness": 80}'::jsonb
          WHEN 'curtain' THEN '{"position": "open"}'::jsonb
          WHEN 'fan'     THEN '{"power": false}'::jsonb
          ELSE '{"power": false}'::jsonb
        END
      FROM ins_scenes s
      JOIN public.devices d ON d.location_id = v_home_id
      WHERE s.name = 'Good Morning'
        AND d.type IN ('light', 'curtain', 'fan');
    END IF;

  END IF;
END $$;
