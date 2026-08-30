import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationInboxButton } from "@/components/planner/notification-inbox";
import type { NotificationInbox } from "@/types/domain";

const mocks = vi.hoisted(() => ({ markRead: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/actions/notifications", () => ({
  markNotificationReadAction: (...args: unknown[]) => mocks.markRead(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

const inbox: NotificationInbox = {
  unreadCount: 1,
  items: [{
    id: "123e4567-e89b-12d3-a456-426614174000",
    kind: "reminder",
    title: "Household reminder",
    body: "Bring the library books",
    deepLink: "/planner?week=2026-08-31&item=item-123",
    scheduledFor: "2026-08-30T14:00:00.000Z",
    createdAt: "2026-08-30T14:00:00.000Z",
    readAt: null,
    channels: {
      email: { status: "delivered", attempts: 1, deliveredAt: "2026-08-30T14:00:02.000Z", lastError: null },
      push: { status: "failed", attempts: 2, deliveredAt: null, lastError: "Apple Push unavailable." },
    },
    target: { kind: "planning_item", weekStart: "2026-08-31", planningItemId: "item-123" },
  }],
};

describe("notification inbox", () => {
  beforeEach(() => {
    mocks.markRead.mockReset();
    mocks.push.mockReset();
    mocks.refresh.mockReset();
    mocks.markRead.mockResolvedValue({ ok: true });
  });

  it("shows unread history and independent channel states", () => {
    render(<NotificationInboxButton initialInbox={inbox} timeZone="America/New_York" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    expect(screen.getByText("Bring the library books")).toBeInTheDocument();
    expect(screen.getByText("Email · Delivered")).toBeInTheDocument();
    expect(screen.getByText("Push · Retrying")).toBeInTheDocument();
  });

  it("marks one item read before following its safe deep link", async () => {
    render(<NotificationInboxButton initialInbox={inbox} timeZone="America/New_York" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: /Household reminder/ }));
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith("123e4567-e89b-12d3-a456-426614174000"));
    expect(mocks.push).toHaveBeenCalledWith("/planner?week=2026-08-31&item=item-123");
  });

  it("marks the visible inbox read in one action", async () => {
    render(<NotificationInboxButton initialInbox={inbox} timeZone="America/New_York" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledWith());
    expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument();
  });
});
