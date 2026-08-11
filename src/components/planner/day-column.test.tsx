import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DayColumn } from "@/components/planner/day-column";
import { getDemoPlannerData } from "@/lib/demo-data";

describe("DayColumn", () => {
  it("keeps scheduled events, plans, and tasks semantically distinct", () => {
    const data = getDemoPlannerData();
    render(
      <DayColumn
        day={data.days[0]}
        categories={data.categories}
        timeZone={data.household.timezone}
        temperatureUnit={data.household.temperatureUnit}
        calendarState={data.calendarState}
        weatherState={data.weatherState}
        onAdd={vi.fn()}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onRetry={vi.fn()}
        onLocation={vi.fn()}
        onWeather={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plans" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByText("Camp")).toBeInTheDocument();
    expect(screen.getByText("Dinner: Pasta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Complete: Groceries/ })).toBeInTheDocument();
  });

  it("quick-adds natural text and toggles a task", () => {
    const data = getDemoPlannerData();
    const onAdd = vi.fn();
    const onToggle = vi.fn();
    render(
      <DayColumn
        day={data.days[0]}
        categories={data.categories}
        timeZone={data.household.timezone}
        temperatureUnit={data.household.temperatureUnit}
        calendarState={data.calendarState}
        weatherState={data.weatherState}
        onAdd={onAdd}
        onToggle={onToggle}
        onEdit={vi.fn()}
        onRetry={vi.fn()}
        onLocation={vi.fn()}
        onWeather={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: /Add a plan/ });
    fireEvent.change(input, { target: { value: "Call camp" } });
    fireEvent.submit(input.closest("form")!);
    expect(onAdd).toHaveBeenCalledWith(data.days[0].date, "Call camp", "note", null);

    fireEvent.click(screen.getByRole("button", { name: /Complete: Groceries/ }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ text: "Groceries" }), true);
  });
});
