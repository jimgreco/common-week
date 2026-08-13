import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocationDialog } from "@/components/planner/dialogs";

const searchLocationsAction = vi.fn();

vi.mock("@/app/actions/planner", () => ({
  searchLocationsAction: (...args: unknown[]) => searchLocationsAction(...args),
}));

describe("LocationDialog", () => {
  beforeEach(() => {
    searchLocationsAction.mockReset();
  });

  it("finds and selects an autocomplete result without requiring a saved location", async () => {
    searchLocationsAction.mockResolvedValue({
      ok: true,
      data: [{
        id: "2988507",
        name: "Paris",
        admin1: "Île-de-France",
        country: "France",
        latitude: 48.8566,
        longitude: 2.3522,
        timezone: "Europe/Paris",
      }],
    });
    const onSave = vi.fn().mockResolvedValue(null);

    render(
      <LocationDialog
        date="2026-08-10"
        locations={[]}
        currentLocationId={null}
        isDemo={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    const search = screen.getByRole("combobox", { name: "Search for a city or place" });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: "Paris" } });
    const suggestion = await screen.findByRole("option", { name: /Paris.*Île-de-France, France/ }, { timeout: 1_500 });
    fireEvent.click(suggestion);

    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set location" })).toBeEnabled();
    fireEvent.click(screen.getByText("This day through Sunday"));
    fireEvent.click(screen.getByRole("button", { name: "Set location" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(
      {
        kind: "search",
        name: "Paris, Île-de-France",
        result: expect.objectContaining({ id: "2988507", timezone: "Europe/Paris" }),
      },
      "through-sunday",
    ));
  });

  it("keeps the dialog open and displays an assignment failure", async () => {
    const onSave = vi.fn().mockResolvedValue("Location changes could not be saved.");

    render(
      <LocationDialog
        date="2026-08-10"
        locations={[{
          id: "location-1",
          name: "Manhattan",
          latitude: 40.7831,
          longitude: -73.9712,
          timezone: "America/New_York",
          isSaved: true,
        }]}
        currentLocationId="location-1"
        isDemo={false}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Set location" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Location changes could not be saved.");
    expect(screen.getByRole("dialog", { name: "Set location · Monday" })).toBeInTheDocument();
  });
});
