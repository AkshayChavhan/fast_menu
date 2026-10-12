// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

import { AttentionList, SummaryTiles } from "@/components/admin/ActivitySummary";
import type { ActivitySummary, AttentionItem } from "@/lib/admin-activity";

afterEach(cleanup);

const summary: ActivitySummary = {
  total: 12,
  live: 9,
  byLifecycle: { trial: 4, starter: 2, pro: 3, grace: 1, dark: 1, not_started: 1 },
  byStatus: { active: 5, quiet: 2, at_risk: 2, stalled: 1, lapsed: 2 },
  trialsEnding: 2,
  plansExpiring: 0,
  paidThisMonthPaise: 1_200_000,
  signupsThisWeek: 3,
};

// The tile whose label is `label`, as text.
const tile = (label: string) => screen.getByText(label).parentElement?.textContent ?? "";

describe("SummaryTiles", () => {
  it("puts the headline numbers on tiles", () => {
    render(<SummaryTiles summary={summary} />);
    expect(tile("Restaurants")).toContain("12");
    expect(tile("Restaurants")).toContain("9 with a live menu");
    expect(tile("Active this week")).toContain("5");
    expect(tile("Active this week")).toContain("2 quiet · 2 at risk");
    expect(tile("New sign-ups")).toContain("3");
    expect(tile("Trials ending")).toContain("2");
    expect(tile("Renewals due")).toContain("0");
  });

  it("shows what was received in whole rupees", () => {
    render(<SummaryTiles summary={summary} />);
    expect(tile("Received this month")).toContain("₹12,000");
    expect(tile("Received this month")).not.toContain(".00");
  });

  it("splits restaurants by where they are with us", () => {
    render(<SummaryTiles summary={summary} />);
    const split = (label: string) =>
      screen.getByText(label, { selector: "dt" }).parentElement?.querySelector("dd")?.textContent;
    expect(split("On trial")).toBe("4");
    expect(split("Starter")).toBe("2");
    expect(split("Pro")).toBe("3");
    expect(split("In grace")).toBe("1");
    expect(split("Gone dark")).toBe("1");
    expect(split("Not started")).toBe("1");
  });
});

const items: AttentionItem[] = [
  {
    kind: "in_grace",
    restaurantId: "r3",
    name: "Lapsed Lounge",
    phone: "+919800000003",
    message: "Plan ended 3 days ago. The menu goes dark in 27 days.",
  },
  {
    kind: "trial_review",
    restaurantId: "r4",
    name: "New Dhaba",
    phone: "+919800000004",
    message: "Waiting for you to review their trial claim.",
  },
  {
    kind: "not_published",
    restaurantId: "r5",
    name: "Draft Diner",
    phone: null,
    message: "Signed up 6 days ago and the menu is still a draft.",
  },
];

const entry = (name: string) => screen.getByText(name).closest("li") as HTMLElement;

describe("AttentionList", () => {
  it("says so when nobody needs a call", () => {
    render(<AttentionList items={[]} />);
    expect(screen.getByText("Nothing needs a call today.")).toBeTruthy();
  });

  it("lists each reason with who it is and why", () => {
    render(<AttentionList items={items} />);
    expect(screen.getByText("3 to follow up, most pressing first")).toBeTruthy();
    const lapsed = entry("Lapsed Lounge");
    expect(lapsed.textContent).toContain("Plan lapsed");
    expect(lapsed.textContent).toContain("The menu goes dark in 27 days.");
  });

  it("jumps to the restaurant's card and offers its number to call", () => {
    render(<AttentionList items={items} />);
    const lapsed = within(entry("Lapsed Lounge"));
    expect(lapsed.getByRole("link", { name: "Lapsed Lounge" }).getAttribute("href")).toBe("#r-r3");
    expect(lapsed.getByRole("link", { name: "+919800000003" }).getAttribute("href")).toBe(
      "tel:+919800000003",
    );
  });

  it("sends a trial review to the review queue instead of the phone", () => {
    render(<AttentionList items={items} />);
    const review = within(entry("New Dhaba"));
    expect(review.getByRole("link", { name: "Review" }).getAttribute("href")).toBe("/admin/trials");
    expect(review.queryByRole("link", { name: "+919800000004" })).toBeNull();
  });

  it("copes with a restaurant that has no phone number", () => {
    render(<AttentionList items={items} />);
    expect(within(entry("Draft Diner")).getAllByRole("link")).toHaveLength(1);
  });
});
