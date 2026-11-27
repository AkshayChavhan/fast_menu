// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import type { Restaurant } from "@/types/db";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const actions = vi.hoisted(() => ({
  updateRestaurantSettings: vi.fn(),
  updateLogo: vi.fn(),
  updateHeroVideo: vi.fn(),
  setPublished: vi.fn(),
}));
vi.mock("@/app/dashboard/settings/actions", () => actions);
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ remove: async () => ({ error: null }) }) } }),
}));

import { SettingsForm } from "@/components/dashboard/settings/SettingsForm";

const restaurant = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Mayavi",
  slug: "mayavi",
  currency: "INR",
  default_locale: "en",
  locales: ["en"],
  is_published: true,
  logo_url: null,
  hero_video_url: null,
} as unknown as Restaurant;

afterEach(cleanup);
beforeEach(() => {
  refresh.mockReset();
  actions.updateHeroVideo.mockReset();
});

function pasteYoutube() {
  fireEvent.change(screen.getByPlaceholderText(/youtu\.be/), {
    target: { value: "https://youtu.be/dQw4w9WgXcQ" },
  });
  fireEvent.click(screen.getByRole("button", { name: /use link/i }));
}

describe("SettingsForm: welcome video", () => {
  it("says so when the server refuses the save", async () => {
    actions.updateHeroVideo.mockResolvedValue({
      ok: false,
      error: "Could not find the 'hero_video_url' column of 'restaurants' in the schema cache",
    });
    render(<SettingsForm restaurant={restaurant} origin="https://x.test" />);
    pasteYoutube();
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Not saved: Could not find the 'hero_video_url' column"),
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("confirms a save that worked", async () => {
    actions.updateHeroVideo.mockResolvedValue({ ok: true });
    render(<SettingsForm restaurant={restaurant} origin="https://x.test" />);
    pasteYoutube();
    expect(await screen.findByText("Saved")).toBeTruthy();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(actions.updateHeroVideo).toHaveBeenCalledWith(
      restaurant.id,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });
});
