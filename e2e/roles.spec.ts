import { expect, test, type Page } from "@playwright/test";

import { E2E } from "./global-setup";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("a waiter lands in the waiter app and is kept out of the dashboard", async ({ page }) => {
  await login(page, E2E.waiter.email, E2E.waiter.password);
  await expect(page).toHaveURL(/\/waiter$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/waiter/);
});

test("the owner lands in the dashboard and sees the billing counter", async ({ page }) => {
  await login(page, E2E.owner.email, E2E.owner.password);
  await expect(page).toHaveURL(/\/dashboard$/);
  // The sidebar is hidden on phones; the Overview tile is on every layout.
  await expect(page.getByRole("link", { name: /Orders & billing/ }).first()).toBeVisible();
});

test("the health endpoint reports the database", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toMatchObject({ ok: true, db: "ok" });
});
