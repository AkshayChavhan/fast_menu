// @vitest-environment jsdom
import { useState } from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PasswordInput } from "@/components/auth/PasswordInput";

afterEach(cleanup);

// The field is controlled on both auth pages, so the test drives it the same way.
function Controlled({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <PasswordInput
      id="password"
      name="password"
      aria-label="Password"
      disabled={disabled}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}

const field = () => screen.getByLabelText("Password");

describe("PasswordInput", () => {
  it("hides the password until the eye is pressed", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    expect(field()).toHaveProperty("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(field()).toHaveProperty("type", "text");

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(field()).toHaveProperty("type", "password");
  });

  it("keeps what was typed when the visibility flips", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    await user.type(field(), "hunter2");
    await user.click(screen.getByRole("button", { name: "Show password" }));

    expect(field()).toHaveProperty("value", "hunter2");
  });

  it("reports its state to assistive tech", async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveProperty("ariaPressed", "false");

    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveProperty(
      "ariaPressed",
      "true",
    );
  });

  // It lives inside a <form>; a default-type button would submit the form and
  // fire off a half-typed sign-in attempt.
  it("is not a submit button", () => {
    render(<Controlled />);
    expect(screen.getByRole("button", { name: "Show password" })).toHaveProperty(
      "type",
      "button",
    );
  });

  it("goes disabled with the form while a request is in flight", () => {
    render(<Controlled disabled />);
    expect(screen.getByRole("button", { name: "Show password" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
