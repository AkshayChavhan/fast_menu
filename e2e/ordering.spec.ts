import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

import { E2E } from "./global-setup";

// The whole loop, in order: a guest orders from the menu, a waiter approves
// it onto a table, the counter settles the bill.

const state = JSON.parse(readFileSync(E2E.stateFile, "utf8")) as { tableToken: string };

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe.serial("guest → waiter → billing", () => {
  let code = "";

  test("a guest places an order from the table QR", async ({ page }) => {
    await page.goto(`/m/${E2E.slug}?t=${state.tableToken}`);
    await expect(page.getByText("You're at Table 1")).toBeVisible();

    await page.getByRole("button", { name: "Add Masala Chai to your order" }).click();
    await page.getByRole("button", { name: "Add Masala Chai to your order" }).click();
    await page.getByRole("link", { name: /View your order/ }).click();

    await expect(page).toHaveURL(/\/cart/);
    await expect(page.getByText("Masala Chai")).toBeVisible();
    await page.getByRole("button", { name: /Place order/ }).click();

    // A refused order stays on the cart with a banner; fail with its text so
    // a CI run says why instead of just "wrong URL".
    const alert = page.getByRole("alert");
    await expect
      .poll(
        async () =>
          (await alert.isVisible()) ? `refused: ${await alert.textContent()}` : page.url(),
        { timeout: 15_000 },
      )
      .toMatch(/\/order\/[A-Z0-9]{6}/);
    await expect(page.getByText("Waiting for your waiter")).toBeVisible();
    code = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  });

  test("a waiter approves it onto the table", async ({ page }) => {
    await login(page, E2E.waiter.email, E2E.waiter.password);
    await expect(page).toHaveURL(/\/waiter/);
    await expect(page.getByText("Waiting for approval")).toBeVisible();

    await page.goto(`/waiter/orders/${code}`);
    await expect(page.getByText("Masala Chai")).toBeVisible();
    // The table from the guest's QR is preselected; Approve is enabled.
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByText("Table 1")).toBeVisible();
  });

  test("the guest sees the confirmation", async ({ page }) => {
    await page.goto(`/m/${E2E.slug}/order/${code}?t=${state.tableToken}`);
    await expect(page.getByText("Confirmed for Table 1")).toBeVisible();
  });

  test("the counter settles the bill", async ({ page }) => {
    await login(page, E2E.owner.email, E2E.owner.password);
    await page.goto("/dashboard/orders");
    await expect(page.getByRole("heading", { name: "Orders & billing" })).toBeVisible();
    await expect(page.getByText("Table 1").first()).toBeVisible();

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: /Mark paid/ }).first().click();
    await expect(page.getByText("Paid today · 1")).toBeVisible();
  });

  test("the guest is thanked", async ({ page }) => {
    await page.goto(`/m/${E2E.slug}/order/${code}?t=${state.tableToken}`);
    await expect(page.getByText("Paid. Thank you!")).toBeVisible();
  });
});
