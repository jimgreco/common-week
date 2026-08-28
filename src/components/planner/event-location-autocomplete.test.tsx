import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventLocationAutocomplete } from "@/components/planner/event-location-autocomplete";

function Harness({ isDemo = false }: { isDemo?: boolean }) {
  const [location, setLocation] = useState("");
  return <EventLocationAutocomplete value={location} onChange={setLocation} isDemo={isDemo} />;
}

describe("EventLocationAutocomplete", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows attributed suggestions and resolves a selected place", async () => {
    const suggestion = {
      placeId: "place-1",
      primaryText: "Yankee Stadium",
      secondaryText: "East 161st Street, Bronx, NY, USA",
      fullText: "Yankee Stadium, East 161st Street, Bronx, NY, USA",
    };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: [suggestion] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: { placeId: "place-1", location: suggestion.fullText, formattedAddress: "1 E 161st St, Bronx, NY" } }), { status: 200 })));

    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Location" });
    fireEvent.change(input, { target: { value: "Yankee Sta" } });
    const option = await screen.findByRole("option", { name: /Yankee Stadium.*East 161st Street/ }, { timeout: 1_500 });

    expect(screen.getByText("Google Maps")).toBeInTheDocument();
    fireEvent.click(option);

    await waitFor(() => expect(input).toHaveValue(suggestion.fullText));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({ placeId: "place-1", suggestedText: suggestion.fullText });
  });

  it("keeps manual entry usable when suggestions fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "Suggestions unavailable." }), { status: 503 })));

    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Location" });
    fireEvent.change(input, { target: { value: "My back patio" } });

    expect(await screen.findByText("Suggestions unavailable.", {}, { timeout: 1_500 })).toBeInTheDocument();
    expect(input).toHaveValue("My back patio");
  });

  it("supports suggestions in the unauthenticated demo", async () => {
    render(<Harness isDemo />);
    fireEvent.change(screen.getByRole("combobox", { name: "Location" }), { target: { value: "Wolffer" } });

    expect(await screen.findByRole("option", { name: /Wölffer Estate Vineyard/ }, { timeout: 1_500 })).toBeInTheDocument();
  });
});
