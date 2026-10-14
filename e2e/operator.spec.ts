import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { E2E } from "./global-setup";

// The operator pages beyond the activity list: the leads call sheet, the
// read-only restaurant page, payments and admin management — and the line
// between the two operator levels. OpenStreetMap is never called here; a
// lead is added by hand so the run does not depend on the network.

const state = JSON.parse(readFileSync(E2E.stateFile, "utf8")) as { restaurantId: string };

async function loginTo(page: Page, path: string, email: string, password: string) {
  await page.goto(`/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Today as YYYY-MM-DD on the operator's clock, which is what the page uses
// to decide a revisit is due.
const todayIst = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

test("the owner works a lead from a city to a logged call", async ({ page }) => {
  await loginTo(page, "/admin/leads", E2E.admin.email, E2E.admin.password);
  await expect(page.getByRole("heading", { level: 1, name: "Leads" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pick a state to start" })).toBeVisible();

  // State → district → city. Each choice is a URL, so wait for it.
  await page.locator("#lead-state").selectOption("Maharashtra");
  await page.waitForURL(/state=Maharashtra/);
  await page.locator("#lead-district").selectOption("Nashik");
  await page.waitForURL(/district=Nashik/);
  await page.locator("#lead-city").selectOption({ label: "Nashik" });
  await page.waitForURL(/city=Q200235/);
  await expect(page.getByRole("heading", { level: 2, name: /^Nashik/ })).toBeVisible();
  await expect(page.getByText("Population 14.9 lakh")).toBeVisible();

  // Nothing yet; add one by hand.
  await page.getByRole("button", { name: "Add restaurant" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(E2E.leadName);
  await dialog.getByLabel("Phone").fill("98111 22333");
  await dialog.getByLabel("Address or landmark").fill("Opposite the bus stand");
  await dialog.getByRole("button", { name: "Add", exact: true }).click();

  // Lands on the lead itself.
  await page.waitForURL(/\/admin\/leads\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { level: 1, name: E2E.leadName })).toBeVisible();
  await expect(page.getByLabel("Where it stands now")).toHaveValue("reached");
  await expect(page.getByText("No calls logged yet.")).toBeVisible();

  // After the first call: what was said, where it stands, what is pending,
  // when to go back.
  await page.getByLabel("What was discussed").fill("Owner was busy, asked to call after 4pm.");
  await page.getByLabel("Where it stands now").selectOption("reached");
  await page.getByLabel("Still pending").fill("Call back after 4pm");
  await page.getByLabel("Revisit on").fill(todayIst);
  await page.getByLabel("Revisit as").selectOption("call");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect(page.getByText("Owner was busy, asked to call after 4pm.")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Call log/ })).toContainText("(1)");

  // The website question is answered on the call, never assumed.
  await expect(page.getByText("Not recorded")).toBeVisible();
  await page.getByLabel("No — confirmed on the call").check();
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("No website")).toBeVisible();

  // Back on the city list, with everything the caller just recorded.
  await page.getByRole("link", { name: /Nashik, Maharashtra/ }).click();
  await page.waitForURL(/city=Q200235/);
  const row = page.getByRole("row", { name: new RegExp(E2E.leadName) });
  await expect(row).toContainText("Reached");
  await expect(row).toContainText("Call back after 4pm");
  await expect(row).toContainText("No website");
  await expect(row.getByRole("link", { name: "98111 22333" })).toHaveAttribute(
    "href",
    "tel:9811122333",
  );
  await expect(page.getByText("1 reached")).toBeVisible();

  // And it is due today, so it heads the page wherever the caller is.
  await page.goto("/admin/leads");
  await expect(page.getByRole("heading", { name: /Due for a revisit/ })).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(E2E.leadName) })).toContainText("Nashik");
});

test("the owner sees one restaurant read-only, with staff and menu", async ({ page }) => {
  await loginTo(
    page,
    `/admin/restaurants/${state.restaurantId}`,
    E2E.admin.email,
    E2E.admin.password,
  );
  await expect(page.getByRole("heading", { level: 1, name: "E2E Café" })).toBeVisible();
  await expect(page.getByText(E2E.owner.email)).toBeVisible();
  await expect(page.getByText("E2E Waiter")).toBeVisible();
  await expect(page.getByText("Masala Chai")).toBeVisible();
  await expect(page.getByText("Filter Coffee")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Menu \(2 dishes\)/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Payments/ })).toBeVisible();
  // Nothing here changes anything.
  await expect(page.getByRole("button")).toHaveCount(0);
});

test("the owner adds an admin, sees it audited, and removes them", async ({ page }) => {
  // Remove asks "are you sure?"; say yes to every dialog in this test.
  page.on("dialog", (d) => d.accept());
  await loginTo(page, "/admin/admins", E2E.admin.email, E2E.admin.password);
  await expect(page.getByRole("heading", { level: 1, name: "Admins" })).toBeVisible();
  const admins = page.getByRole("list", { name: "Platform admins" });
  const changes = page.getByRole("list", { name: "What owners changed" });
  await expect(admins.getByText(E2E.admin.email)).toBeVisible();
  await expect(admins.getByText("you", { exact: true })).toBeVisible();

  await page.getByLabel("Email").fill(E2E.newAdminEmail);
  await page.getByLabel("Level").selectOption("admin");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const row = admins.locator("li", { hasText: E2E.newAdminEmail });
  await expect(row).toBeVisible();
  await expect(row.getByRole("combobox")).toHaveValue("admin");
  // Newest first; .first() so a retried run, which adds them twice, still reads.
  await expect(changes.getByText(`${E2E.newAdminEmail} set to admin`).first()).toBeVisible();

  await row.getByRole("button", { name: "Remove" }).click();
  // If the action was refused, say why rather than just "still there".
  await expect
    .poll(async () => (await page.getByRole("alert").count()) ? await page.getByRole("alert").textContent() : null, {
      message: "no error after Remove",
    })
    .toBeNull();
  await expect(row).toHaveCount(0);
  await expect(changes.getByText(`${E2E.newAdminEmail} removed`).first()).toBeVisible();

  // Money is one click away for the owner.
  await page.getByRole("link", { name: "Payments", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Payments" })).toBeVisible();
  await expect(page.getByText("Paid, all time")).toBeVisible();
});

test("a support admin can look but not change money or people", async ({ page }) => {
  await loginTo(page, "/admin", E2E.support.email, E2E.support.password);
  await expect(page.getByRole("heading", { level: 1, name: "Restaurants" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Payments", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Admins", exact: true })).toHaveCount(0);

  // Plans: the list, without the buttons.
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Plans" })).toBeVisible();
  await expect(page.getByText("E2E Café").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Pro · 12 months" })).toHaveCount(0);

  // The restaurant page opens, minus the payments.
  await page.goto(`/admin/restaurants/${state.restaurantId}`);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Café" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Payments/ })).toHaveCount(0);

  // The owner-only pages do not exist for them.
  for (const path of ["/admin/payments", "/admin/admins"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});
