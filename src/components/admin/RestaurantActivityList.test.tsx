// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RestaurantActivityList } from "@/components/admin/RestaurantActivityList";
import type { RestaurantView } from "@/lib/admin-activity";

afterEach(cleanup);

const NOW = "2026-10-12T06:30:00.000Z";

const view = (o: Partial<RestaurantView> = {}): RestaurantView => ({
  id: "r1",
  name: "Busy Bhojnalaya",
  slug: "busy-bhojnalaya",
  city: "Nagpur",
  phone: "+919800000001",
  ownerEmail: "owner@busy.example",
  createdAt: "2026-07-14T06:30:00.000Z",
  lifecycle: "pro",
  status: "active",
  effectivePlan: "pro",
  isLive: true,
  endsAt: "2027-04-30T06:30:00.000Z",
  darkAt: null,
  trialStatus: "active",
  setup: [
    { key: "published", label: "Published", done: true },
    { key: "dishes", label: "40 dishes", done: true },
    { key: "kitchen", label: "Kitchen screen", done: false },
  ],
  setupDone: 2,
  orders7d: 50,
  orders30d: 200,
  guestSharePct: 75,
  lastOrderAt: "2026-10-12T04:30:00.000Z",
  lastActivityAt: "2026-10-12T04:30:00.000Z",
  ...o,
});

const restaurants: RestaurantView[] = [
  view(),
  view({
    id: "r2",
    name: "Quiet Corner",
    slug: "quiet-corner",
    city: "Pune",
    phone: "+919800000002",
    ownerEmail: "hello@quiet.example",
    lifecycle: "starter",
    status: "quiet",
    effectivePlan: "starter",
    orders7d: 0,
    orders30d: 0,
    guestSharePct: null,
    lastOrderAt: null,
    lastActivityAt: "2026-09-30T06:30:00.000Z",
  }),
  view({
    id: "r3",
    name: "Lapsed Lounge",
    slug: "lapsed-lounge",
    city: null,
    phone: null,
    ownerEmail: null,
    lifecycle: "dark",
    status: "lapsed",
    effectivePlan: "starter",
    isLive: false,
    endsAt: "2026-08-01T06:30:00.000Z",
  }),
];

const setup = (list = restaurants) =>
  render(<RestaurantActivityList restaurants={list} nowIso={NOW} />);

const card = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
const names = () =>
  Array.from(document.querySelectorAll('li[id^="r-"]')).map(
    (li) => li.querySelector("p")?.textContent,
  );

describe("RestaurantActivityList", () => {
  it("lists every restaurant with a count on each status filter", () => {
    setup();
    expect(names()).toEqual(["Busy Bhojnalaya", "Quiet Corner", "Lapsed Lounge"]);
    expect(screen.getByRole("button", { name: "All 3" })).toHaveProperty("ariaPressed", "true");
    expect(screen.getByRole("button", { name: "Active 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stalled setup 0" })).toBeTruthy();
  });

  it("narrows to one status and says what that status means", async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole("button", { name: "Lapsed 1" }));
    expect(names()).toEqual(["Lapsed Lounge"]);
    expect(screen.getByText(/Trial or plan has ended/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "All 3" }));
    expect(names()).toHaveLength(3);
  });

  it("searches by name, city, phone or email", async () => {
    const user = userEvent.setup();
    setup();
    const box = screen.getByLabelText("Search restaurants");

    await user.type(box, "pune");
    expect(names()).toEqual(["Quiet Corner"]);

    await user.clear(box);
    await user.type(box, "0000001");
    expect(names()).toEqual(["Busy Bhojnalaya"]);

    await user.clear(box);
    await user.type(box, "QUIET.EXAMPLE");
    expect(names()).toEqual(["Quiet Corner"]);
  });

  it("says so when the filter and the search leave nothing", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button", { name: "Stalled setup 0" }));
    expect(screen.getByText("No restaurants match.")).toBeTruthy();
  });

  it("has an empty state before anyone has signed up", () => {
    setup([]);
    expect(screen.getByText("No restaurants yet.")).toBeTruthy();
  });

  it("shows order counts and the guest share, and no rupee figure", () => {
    setup();
    const busy = card("Busy Bhojnalaya");
    expect(busy.textContent).toContain("50 in 7 days · 200 in 30");
    expect(busy.textContent).toContain("Last order 2 h ago · 75% placed by guests");
    expect(busy.textContent).toContain("Paid until 30 Apr 2027");
    expect(busy.textContent).not.toContain("₹");
  });

  it("does not show a Starter restaurant as having zero orders", () => {
    setup();
    const quiet = card("Quiet Corner");
    expect(quiet.textContent).toContain("Menu only on this plan");
    expect(quiet.textContent).toContain("Menu edited 12 d ago");
    expect(quiet.textContent).not.toContain("in 7 days");
  });

  it("keeps showing a lapsed Pro restaurant the orders it used to take", () => {
    setup();
    const lapsed = card("Lapsed Lounge");
    expect(lapsed.textContent).toContain("Last order 2 h ago");
    expect(lapsed.textContent).not.toContain("Menu only on this plan");
  });

  it("links to the menu only while guests can open it", () => {
    setup();
    const open = within(card("Busy Bhojnalaya")).getByRole("link", { name: /Open menu/ });
    expect(open.getAttribute("href")).toBe("/m/busy-bhojnalaya");

    const lapsed = card("Lapsed Lounge");
    expect(within(lapsed).queryByRole("link", { name: /Open menu/ })).toBeNull();
    expect(lapsed.textContent).toContain("Menu not reachable");
    expect(lapsed.textContent).toContain("Ended 01 Aug 2026");
  });

  it("makes the phone and email tappable, and copes with neither", () => {
    setup();
    const busy = within(card("Busy Bhojnalaya"));
    expect(busy.getByRole("link", { name: "+919800000001" }).getAttribute("href")).toBe(
      "tel:+919800000001",
    );
    expect(busy.getByRole("link", { name: "owner@busy.example" }).getAttribute("href")).toBe(
      "mailto:owner@busy.example",
    );
    expect(within(card("Lapsed Lounge")).queryByRole("link", { name: /@/ })).toBeNull();
  });

  it("marks each setup step done or not, with a tally", () => {
    setup();
    const busy = card("Busy Bhojnalaya");
    expect(busy.textContent).toContain("Setup · 2 of 3");
    expect(within(busy).getByText("40 dishes").textContent).toContain("(done)");
    expect(within(busy).getByText("Kitchen screen").textContent).toContain("(not done)");
  });

  it("gives each card an anchor the needs-attention list can jump to", () => {
    setup();
    expect(card("Quiet Corner").id).toBe("r-r2");
  });
});
