import { createClient } from "@/lib/supabase/server";
import { localClock } from "@/lib/schedule";
import { sortByLabel } from "@/lib/tables";
import type {
  Order,
  OrderItem,
  RestaurantTable,
  ServiceRequest,
  TableSession,
} from "@/types/db";

// Reads for the billing counter: every open bill with its orders, and the
// bills settled today by the restaurant's own calendar.

export interface BillOrder extends Order {
  items: OrderItem[];
}

export interface Bill extends TableSession {
  tables: RestaurantTable[];
  orders: BillOrder[];
  requests: ServiceRequest[];
}

export interface BillingData {
  open: Bill[];
  paidToday: Bill[];
  /** Sum of today's settled bills, in minor units. */
  todayCents: number;
  today: string;
}

type Db = Awaited<ReturnType<typeof createClient>>;

async function billsFor(
  supabase: Db,
  sessions: TableSession[],
  tableById: Map<string, RestaurantTable>,
): Promise<Bill[]> {
  if (sessions.length === 0) return [];
  const ids = sessions.map((s) => s.id);

  const [linksRes, ordersRes, requestsRes] = await Promise.all([
    supabase.from("table_session_tables").select("session_id, table_id").in("session_id", ids),
    supabase
      .from("orders")
      .select("*")
      .in("session_id", ids)
      .in("status", ["approved", "settled"])
      .order("approved_at", { ascending: true }),
    supabase.from("service_requests").select("*").in("session_id", ids).eq("status", "open"),
  ]);

  const orders = (ordersRes.data as Order[] | null) ?? [];
  const itemsByOrder = new Map<string, OrderItem[]>();
  if (orders.length > 0) {
    const { data: items } = await supabase
      .from("order_items")
      .select("*")
      .in("order_id", orders.map((o) => o.id))
      .order("sort_order", { ascending: true });
    for (const item of (items as OrderItem[] | null) ?? []) {
      const list = itemsByOrder.get(item.order_id);
      if (list) list.push(item);
      else itemsByOrder.set(item.order_id, [item]);
    }
  }

  const tablesBySession = new Map<string, RestaurantTable[]>();
  for (const link of (linksRes.data as { session_id: string; table_id: string }[] | null) ?? []) {
    const t = tableById.get(link.table_id);
    if (!t) continue;
    const list = tablesBySession.get(link.session_id);
    if (list) list.push(t);
    else tablesBySession.set(link.session_id, [t]);
  }
  const requests = (requestsRes.data as ServiceRequest[] | null) ?? [];

  return sessions.map((s) => ({
    ...s,
    tables: sortByLabel(tablesBySession.get(s.id) ?? []),
    orders: orders
      .filter((o) => o.session_id === s.id)
      .map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] })),
    requests: requests.filter((r) => r.session_id === s.id),
  }));
}

export async function loadBilling(restaurantId: string, timezone: string): Promise<BillingData> {
  const supabase = await createClient();
  const now = new Date();
  const today = localClock(now, timezone).date;

  const [tablesRes, openRes, closedRes] = await Promise.all([
    supabase.from("tables").select("*").eq("restaurant_id", restaurantId),
    supabase
      .from("table_sessions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .in("status", ["open", "bill_requested"])
      .order("opened_at", { ascending: true }),
    // A day in any timezone fits inside the last 36 hours; filter to the
    // local date below.
    supabase
      .from("table_sessions")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("status", "closed")
      .gte("closed_at", new Date(now.getTime() - 36 * 3600 * 1000).toISOString())
      .order("closed_at", { ascending: false }),
  ]);

  const tables = (tablesRes.data as RestaurantTable[] | null) ?? [];
  const tableById = new Map(tables.map((t) => [t.id, t]));

  const openSessions = ((openRes.data as TableSession[] | null) ?? []).sort((a, b) => {
    // Bills the guest asked for come first, then oldest first.
    if (a.status !== b.status) return a.status === "bill_requested" ? -1 : 1;
    return a.opened_at.localeCompare(b.opened_at);
  });
  const closedToday = ((closedRes.data as TableSession[] | null) ?? []).filter(
    (s) => s.closed_at && localClock(new Date(s.closed_at), timezone).date === today,
  );

  const [open, paidToday] = await Promise.all([
    billsFor(supabase, openSessions, tableById),
    billsFor(supabase, closedToday, tableById),
  ]);

  return {
    open,
    paidToday,
    todayCents: paidToday.reduce((n, s) => n + s.total_cents, 0),
    today,
  };
}
