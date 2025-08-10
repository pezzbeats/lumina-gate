import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export function useRealtimeTables(tables: string[], onChange: () => void) {
  useEffect(() => {
    const channel = supabase
      .channel("schema-db-changes")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: tables[0] as any }, onChange);

    // subscribe to all tables for insert/update/delete
    tables.forEach((t) => {
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: t }, onChange)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: t }, onChange)
        .on("postgres_changes", { event: "DELETE", schema: "public", table: t }, onChange);
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [JSON.stringify(tables), onChange]);
}
