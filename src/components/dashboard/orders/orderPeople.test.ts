import { describe, it, expect } from "vitest";
import { orderPeople } from "@/components/dashboard/orders/BillingCounter";

const people = { u1: "Ravi", u2: "Priya" };

describe("orderPeople", () => {
  it("names who approved a guest's order", () => {
    expect(orderPeople({ source: "customer", created_by: null, approved_by: "u1" }, people)).toBe(
      "by guest · approved by Ravi",
    );
  });

  it("names the waiter who took an order themselves", () => {
    expect(orderPeople({ source: "waiter", created_by: "u2", approved_by: "u2" }, people)).toBe(
      "by Priya",
    );
  });

  it("falls back to the old wording when the name isn't known", () => {
    expect(orderPeople({ source: "customer", created_by: null, approved_by: "gone" }, people)).toBe(
      "by guest",
    );
    expect(orderPeople({ source: "waiter", created_by: null, approved_by: null }, {})).toBe(
      "by staff",
    );
  });
});
