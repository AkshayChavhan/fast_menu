import { createClient } from "@/lib/supabase/server";
import type { Order, OrderItem, RestaurantTable, TableSession } from "@/types/db";

// Tickets for the kitchen screen: approved orders with at least one line
// not yet served, oldest first. Names come from the line snapshots, so a
// renamed dish never changes a ticket mid-cook.

export interface Ticket extends Order {
  items: OrderItem[];
  /** "Table 5", "Table 5 + 6", "Parcel · Ravi", or "Walk-in". */
  where: string;
  /** Every line is ready or served. */
  ready: boolean;
}

export async function loadTickets(restaurantId: string): Promise<Ticket[]> {
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("status", "approved")
    .order("approved_at", { ascending: true })
    .limit(80);
  const rows = (orders as Order[] | null) ?? [];
  if (rows.length === 0) return [];

  const sessionIds = Array.from(new Set(rows.map((o) => o.session_id).filter((id): id is string => !!id)));
  const [itemsRes, sessionsRes, linksRes] = await Promise.all([
    supabase
      .from("order_items")
      .select("*")
      .in("order_id", rows.map((o) => o.id))
      .order("sort_order", { ascending: true }),
    sessionIds.length
      ? supabase.from("table_sessions").select("*").in("id", sessionIds)
      : Promise.resolve({ data: [] as TableSession[] }),
    sessionIds.length
      ? supabase.from("table_session_tables").select("session_id, table_id").in("session_id", sessionIds)
      : Promise.resolve({ data: [] as { session_id: string; table_id: string }[] }),
  ]);

  const links = (linksRes.data as { session_id: string; table_id: string }[] | null) ?? [];
  const tableIds = Array.from(new Set(links.map((l) => l.table_id)));
  const { data: tableRows } = tableIds.length
    ? await supabase.from("tables").select("*").in("id", tableIds)
    : { data: [] as RestaurantTable[] };
  const tableById = new Map(((tableRows as RestaurantTable[] | null) ?? []).map((t) => [t.id, t]));
  const sessionById = new Map(((sessionsRes.data as TableSession[] | null) ?? []).map((s) => [s.id, s]));
  const tablesBySession = new Map<string, string[]>();
  for (const l of links) {
    const label = tableById.get(l.table_id)?.label;
    if (!label) continue;
    const list = tablesBySession.get(l.session_id);
    if (list) list.push(label);
    else tablesBySession.set(l.session_id, [label]);
  }

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of (itemsRes.data as OrderItem[] | null) ?? []) {
    const list = itemsByOrder.get(item.order_id);
    if (list) list.push(item);
    else itemsByOrder.set(item.order_id, [item]);
  }

  return rows
    .map((o) => {
      const items = itemsByOrder.get(o.id) ?? [];
      const session = o.session_id ? sessionById.get(o.session_id) : undefined;
      const labels = o.session_id ? (tablesBySession.get(o.session_id) ?? []).sort() : [];
      const where =
        labels.length > 0
          ? labels.join(" + ")
          : o.service_type === "takeaway"
            ? `Parcel${session?.guest_label ? ` · ${session.guest_label}` : ""}`
            : (session?.guest_label ?? "Walk-in");
      return {
        ...o,
        items,
        where,
        ready: items.length > 0 && items.every((i) => i.kds_status === "ready" || i.kds_status === "served"),
      };
    })
    .filter((t) => t.items.some((i) => i.kds_status !== "served"));
}
