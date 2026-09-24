import { createClient } from "@/lib/supabase/server";
import { sortByLabel } from "@/lib/tables";
import type {
  Order,
  OrderEvent,
  OrderItem,
  RestaurantTable,
  ServiceRequest,
  TableSession,
} from "@/types/db";

// Reads for the waiter app. Everything comes through the member-read
// policies, so a signed-in staff member only ever sees their own restaurant.

export interface OrderWithItems extends Order {
  items: OrderItem[];
  table_label: string | null;
}

export interface SessionWithTables extends TableSession {
  tables: RestaurantTable[];
  orders: OrderWithItems[];
}

export interface RequestWithTable extends ServiceRequest {
  table_label: string | null;
}

export interface WaiterHome {
  placed: OrderWithItems[];
  sessions: SessionWithTables[];
  requests: RequestWithTable[];
  tables: RestaurantTable[];
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function itemsFor(supabase: Db, orderIds: string[]): Promise<Map<string, OrderItem[]>> {
  const byOrder = new Map<string, OrderItem[]>();
  if (orderIds.length === 0) return byOrder;
  const { data } = await supabase
    .from("order_items")
    .select("*")
    .in("order_id", orderIds)
    .order("sort_order", { ascending: true });
  for (const item of (data as OrderItem[] | null) ?? []) {
    const list = byOrder.get(item.order_id);
    if (list) list.push(item);
    else byOrder.set(item.order_id, [item]);
  }
  return byOrder;
}

export async function loadTables(restaurantId: string): Promise<RestaurantTable[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("tables")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("is_active", true);
  return sortByLabel((data as RestaurantTable[] | null) ?? []);
}

export async function loadWaiterHome(restaurantId: string): Promise<WaiterHome> {
  const supabase = await createClient();

  const [placedRes, sessionsRes, requestsRes, tablesRes] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("status", "placed")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true }),
    supabase
      .from("table_sessions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .in("status", ["open", "bill_requested"])
      .order("opened_at", { ascending: true }),
    supabase
      .from("service_requests")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("status", "open")
      .order("created_at", { ascending: true }),
    supabase.from("tables").select("*").eq("restaurant_id", restaurantId),
  ]);

  const tables = (tablesRes.data as RestaurantTable[] | null) ?? [];
  const tableById = new Map(tables.map((t) => [t.id, t]));
  const label = (id: string | null) => (id ? (tableById.get(id)?.label ?? null) : null);

  const placedRows = (placedRes.data as Order[] | null) ?? [];
  const sessions = (sessionsRes.data as TableSession[] | null) ?? [];

  const [sessionTablesRes, sessionOrdersRes] = await Promise.all([
    sessions.length
      ? supabase
          .from("table_session_tables")
          .select("session_id, table_id")
          .in("session_id", sessions.map((s) => s.id))
      : Promise.resolve({ data: [] as { session_id: string; table_id: string }[] }),
    sessions.length
      ? supabase
          .from("orders")
          .select("*")
          .in("session_id", sessions.map((s) => s.id))
          .in("status", ["approved", "settled"])
          .order("approved_at", { ascending: true })
      : Promise.resolve({ data: [] as Order[] }),
  ]);

  const sessionOrders = (sessionOrdersRes.data as Order[] | null) ?? [];
  const items = await itemsFor(
    supabase,
    [...placedRows, ...sessionOrders].map((o) => o.id),
  );
  const withItems = (o: Order): OrderWithItems => ({
    ...o,
    items: items.get(o.id) ?? [],
    table_label: label(o.table_id),
  });

  const tablesBySession = new Map<string, RestaurantTable[]>();
  for (const row of (sessionTablesRes.data as { session_id: string; table_id: string }[] | null) ?? []) {
    const t = tableById.get(row.table_id);
    if (!t) continue;
    const list = tablesBySession.get(row.session_id);
    if (list) list.push(t);
    else tablesBySession.set(row.session_id, [t]);
  }

  return {
    placed: placedRows.map(withItems),
    sessions: sessions.map((s) => ({
      ...s,
      tables: sortByLabel(tablesBySession.get(s.id) ?? []),
      orders: sessionOrders.filter((o) => o.session_id === s.id).map(withItems),
    })),
    requests: ((requestsRes.data as ServiceRequest[] | null) ?? []).map((r) => ({
      ...r,
      table_label: label(r.table_id),
    })),
    tables: sortByLabel(tables.filter((t) => t.is_active)),
  };
}

export interface OrderDetail extends OrderWithItems {
  session: (TableSession & { tables: RestaurantTable[] }) | null;
  events: OrderEvent[];
}

// One order by its code, scoped to the restaurant.
export async function loadOrderByCode(restaurantId: string, code: string): Promise<OrderDetail | null> {
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("code", code.trim().toUpperCase())
    .maybeSingle<Order>();
  if (!order) return null;

  const [itemsRes, eventsRes, tableRes, sessionRes] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", order.id).order("sort_order"),
    supabase.from("order_events").select("*").eq("order_id", order.id).order("created_at"),
    order.table_id
      ? supabase.from("tables").select("label").eq("id", order.table_id).maybeSingle<{ label: string }>()
      : Promise.resolve({ data: null }),
    order.session_id
      ? supabase.from("table_sessions").select("*").eq("id", order.session_id).maybeSingle<TableSession>()
      : Promise.resolve({ data: null }),
  ]);

  let session: OrderDetail["session"] = null;
  if (sessionRes.data) {
    const { data: links } = await supabase
      .from("table_session_tables")
      .select("table_id")
      .eq("session_id", sessionRes.data.id);
    const ids = ((links as { table_id: string }[] | null) ?? []).map((l) => l.table_id);
    const { data: tables } = ids.length
      ? await supabase.from("tables").select("*").in("id", ids)
      : { data: [] as RestaurantTable[] };
    session = { ...sessionRes.data, tables: sortByLabel((tables as RestaurantTable[] | null) ?? []) };
  }

  return {
    ...order,
    items: (itemsRes.data as OrderItem[] | null) ?? [],
    table_label: tableRes.data?.label ?? null,
    events: (eventsRes.data as OrderEvent[] | null) ?? [],
    session,
  };
}

// Which active tables are currently on an open bill, and with which label.
export async function loadOccupiedTables(restaurantId: string): Promise<Map<string, { sessionId: string; label: string }>> {
  const supabase = await createClient();
  const { data: sessions } = await supabase
    .from("table_sessions")
    .select("id, guest_label, status")
    .eq("restaurant_id", restaurantId)
    .in("status", ["open", "bill_requested"]);
  const list = (sessions as { id: string; guest_label: string | null; status: string }[] | null) ?? [];
  const occupied = new Map<string, { sessionId: string; label: string }>();
  if (list.length === 0) return occupied;

  const { data: links } = await supabase
    .from("table_session_tables")
    .select("session_id, table_id")
    .in("session_id", list.map((s) => s.id));
  const byId = new Map(list.map((s) => [s.id, s]));
  for (const link of (links as { session_id: string; table_id: string }[] | null) ?? []) {
    const s = byId.get(link.session_id);
    if (!s) continue;
    occupied.set(link.table_id, {
      sessionId: s.id,
      label: s.status === "bill_requested" ? "bill requested" : (s.guest_label ?? "on a bill"),
    });
  }
  return occupied;
}
