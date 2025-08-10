-- 1) Enable RLS and replace permissive policies
alter table if exists public.locations enable row level security;
alter table if exists public.devices enable row level security;
alter table if exists public.sensor_events enable row level security;
alter table if exists public.scenes enable row level security;
alter table if exists public.scene_actions enable row level security;
alter table if exists public.app_settings enable row level security;

-- Drop existing allow-all policies if they exist
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='locations' AND policyname='locations_all'
  ) THEN EXECUTE 'drop policy locations_all on public.locations'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices' AND policyname='devices_all'
  ) THEN EXECUTE 'drop policy devices_all on public.devices'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sensor_events' AND policyname='sensor_events_all'
  ) THEN EXECUTE 'drop policy sensor_events_all on public.sensor_events'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scenes' AND policyname='scenes_all'
  ) THEN EXECUTE 'drop policy scenes_all on public.scenes'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scene_actions' AND policyname='scene_actions_all'
  ) THEN EXECUTE 'drop policy scene_actions_all on public.scene_actions'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' AND policyname='app_settings_all'
  ) THEN EXECUTE 'drop policy app_settings_all on public.app_settings'; END IF;
END $$;

-- READ ONLY for anon/auth
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='locations' AND policyname='ro_locations'
  ) THEN EXECUTE 'create policy ro_locations on public.locations for select using (true)'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices' AND policyname='ro_devices'
  ) THEN EXECUTE 'create policy ro_devices on public.devices for select using (true)'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sensor_events' AND policyname='ro_events'
  ) THEN EXECUTE 'create policy ro_events on public.sensor_events for select using (true)'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scenes' AND policyname='ro_scenes'
  ) THEN EXECUTE 'create policy ro_scenes on public.scenes for select using (true)'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scene_actions' AND policyname='ro_scene_actions'
  ) THEN EXECUTE 'create policy ro_scene_actions on public.scene_actions for select using (true)'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' AND policyname='ro_app_settings'
  ) THEN EXECUTE 'create policy ro_app_settings on public.app_settings for select using (true)'; END IF;
END $$;

-- SERVICE ROLE full access
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='locations' AND policyname='srv_locations'
  ) THEN EXECUTE 'create policy srv_locations on public.locations for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='devices' AND policyname='srv_devices'
  ) THEN EXECUTE 'create policy srv_devices on public.devices for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='sensor_events' AND policyname='srv_events'
  ) THEN EXECUTE 'create policy srv_events on public.sensor_events for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scenes' AND policyname='srv_scenes'
  ) THEN EXECUTE 'create policy srv_scenes on public.scenes for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='scene_actions' AND policyname='srv_scene_actions'
  ) THEN EXECUTE 'create policy srv_scene_actions on public.scene_actions for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='app_settings' AND policyname='srv_app_settings'
  ) THEN EXECUTE 'create policy srv_app_settings on public.app_settings for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')'; END IF;
END $$;

-- 2) Normalize device type + add guard rails
DO $$ BEGIN
  CREATE TYPE public.device_type AS ENUM ('light','fan','ac','curtain','geyser','sensor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Drop old text-based check constraint before changing column type
alter table public.devices drop constraint if exists devices_type_check;

alter table public.devices
  alter column "type" type public.device_type using "type"::public.device_type;

create unique index if not exists ux_devices_location_name
  on public.devices (location_id, lower(name));

-- 3) Performance helpers
alter table public.devices
  add column if not exists power boolean generated always as ((state->>'power')::boolean) stored;

create index if not exists ix_devices_location on public.devices(location_id);
create index if not exists ix_devices_power on public.devices(power);
create index if not exists ix_events_device_time on public.sensor_events(device_id, timestamp desc);

-- 4) Realtime safety
alter table public.locations      replica identity full;
alter table public.devices        replica identity full;
alter table public.sensor_events  replica identity full;
alter table public.scenes         replica identity full;
alter table public.scene_actions  replica identity full;
alter table public.app_settings   replica identity full;

-- Ensure devices is in supabase_realtime publication if missing
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='devices';
  IF NOT FOUND THEN
    EXECUTE 'alter publication supabase_realtime add table public.devices';
  END IF;
END $$;