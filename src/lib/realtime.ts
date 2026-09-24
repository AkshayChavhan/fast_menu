"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

// Refresh the current server-rendered page whenever one of `tables` changes
// for this restaurant. Supabase Realtime honours RLS, so staff only hear
// about their own rows. A slow poll remains as a fallback for networks that
// block websockets; pass 0 to disable it.
export function useRealtimeRefresh(
  restaurantId: string,
  tables: string[],
  fallbackMs = 15000,
): void {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    // Coalesce bursts (an order plus its items plus the session total).
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 250);
    };

    let channel = supabase.channel(`rt:${restaurantId}:${tables.join(",")}`);
    for (const table of tables) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `restaurant_id=eq.${restaurantId}` },
        refresh,
      );
    }
    channel.subscribe();

    const poll = fallbackMs > 0 ? setInterval(() => router.refresh(), fallbackMs) : null;

    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (poll) clearInterval(poll);
      supabase.removeChannel(channel);
    };
    // tables is read once per mount; callers pass a literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, router, tables.join(",")]);
}
