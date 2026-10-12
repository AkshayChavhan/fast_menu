import { expect, test, type Page } from "@playwright/test";

import { E2E } from "./global-setup";

// The operator dashboard: a platform admin sees every restaurant, and nobody
// else is told the page exists.

async function loginTo(page: Page, path: string, email: string, password: string) {
  await page.goto(`/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("a platform admin sees the restaurants and how they are doing", async ({ page }) => {
  await loginTo(page, "/admin", E2E.admin.email, E2E.admin.password);
  await expect(page).toHaveURL(/\/admin$/);

  await expect(page.getByRole("heading", { level: 1, name: "Restaurants" })).toBeVisible();
  await expect(page.getByText("Active this week")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();

  // Narrow the list to the e2e restaurant: published, on a live trial, with a
  // menu built moments ago by the global setup.
  await page.getByLabel("Search restaurants").fill("E2E Café");
  const cards = page.locator('li[id^="r-"]');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText("E2E Café");
  await expect(cards.first()).toContainText("On trial");
  await expect(cards.first()).toContainText("2 dishes");
  await expect(cards.first().getByRole("link", { name: /Open menu/ })).toHaveAttribute(
    "href",
    `/m/${E2E.slug}`,
  );

  // The other operator pages are one click away.
  await page.getByRole("link", { name: "Plans", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/plans$/);
  await expect(page.getByRole("link", { name: "Restaurants", exact: true })).toBeVisible();
});

test("an owner who is not a platform admin gets a 404", async ({ page }) => {
  await loginTo(page, "/dashboard", E2E.owner.email, E2E.owner.password);
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Restaurants" })).toHaveCount(0);
});
