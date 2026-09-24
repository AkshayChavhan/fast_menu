// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { StaffAvatar, initialsFor } from "@/components/dashboard/staff/StaffAvatar";

afterEach(cleanup);

describe("initialsFor()", () => {
  it("takes the first letters of the first and last words", () => {
    expect(initialsFor("Ravi Kumar")).toBe("RK");
    expect(initialsFor("  Anna Maria Lopez ")).toBe("AL");
  });

  it("uses one letter for a single word, such as a login email", () => {
    expect(initialsFor("ravi")).toBe("R");
    expect(initialsFor("ravi@example.com")).toBe("R");
  });

  it("falls back to a question mark", () => {
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
    expect(initialsFor(null)).toBe("?");
  });
});

describe("StaffAvatar", () => {
  it("shows the photo when there is one", () => {
    render(<StaffAvatar src="https://example.com/ravi.jpg" name="Ravi Kumar" />);
    const avatar = screen.getByRole("img", { name: "Ravi Kumar" });
    expect(avatar.querySelector("img")?.getAttribute("src")).toBe(
      "https://example.com/ravi.jpg",
    );
    expect(avatar.textContent).toBe("");
  });

  it("shows initials when there is no photo", () => {
    render(<StaffAvatar src={null} name="Ravi Kumar" />);
    const avatar = screen.getByRole("img", { name: "Ravi Kumar" });
    expect(avatar.querySelector("img")).toBeNull();
    expect(avatar.textContent).toBe("RK");
  });

  it("still has an accessible name without a display name", () => {
    render(<StaffAvatar src={null} name={null} />);
    expect(screen.getByRole("img", { name: "Staff member" }).textContent).toBe("?");
  });
});
