import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DayColumn } from "@/components/planner/day-column";
import { getDemoPlannerData } from "@/lib/demo-data";

describe("DayColumn", () => {
  it("keeps scheduled events, plans, and tasks semantically distinct", () => {
    const data = getDemoPlannerData();
    const onEvent = vi.fn();
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
        onEvent={onEvent}
      />,
    );

    expect(screen.getByRole("heading", { name: "Calendar" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plans" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByText("Camp")).toBeInTheDocument();
    expect(screen.getByText("Miriam's school")).toBeInTheDocument();
    const camp = screen.getByRole("button", { name: /Camp, 9:15–10:15 AM/ });
    fireEvent.click(camp);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ id: "e1", title: "Camp" }));
    expect(screen.getByText("Dinner: Pasta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Complete: Groceries/ })).toBeInTheDocument();
  });

  it("adds plans and tasks inline and toggles a task", () => {
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
        onEvent={vi.fn()}
      />,
    );

    const planInput = screen.getByRole("textbox", { name: /Add a plan/ });
    fireEvent.change(planInput, { target: { value: "Call camp" } });
    fireEvent.submit(planInput.closest("form")!);
    expect(onAdd).toHaveBeenCalledWith(data.days[0].date, "Call camp", "note", null);

    const taskInput = screen.getByRole("textbox", { name: /Add a task/ });
    fireEvent.change(taskInput, { target: { value: "Pack towels" } });
    fireEvent.submit(taskInput.closest("form")!);
    expect(onAdd).toHaveBeenCalledWith(data.days[0].date, "Pack towels", "task", null);

    fireEvent.click(screen.getByRole("button", { name: /Complete: Groceries/ }));
    expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ text: "Groceries" }), true);
  });

  it("keeps unsaved inline text when focus leaves the field", () => {
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
        onEvent={vi.fn()}
      />,
    );

    const input = screen.getByRole("textbox", { name: /Add a plan/ });
    fireEvent.click(input.closest("form")!);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Dinner outside if sunny" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("Dinner outside if sunny");
  });
});
