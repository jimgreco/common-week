import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("follows its safe deep link and marks the item read", async () => {
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
    await waitFor(() => expect(screen.queryByRole("button", { name: "Mark all read" })).not.toBeInTheDocument());
  });
});


describe("notification update recovery", () => {
  beforeEach(() => {
    mocks.markRead.mockReset();
    mocks.push.mockReset();
    mocks.refresh.mockReset();
  });

  it.each(["rejected", "failed"])("opens a reminder even when its read update is %s", async (failure) => {
    let finish!: () => void;
    mocks.markRead.mockReturnValue(new Promise((resolve, reject) => {
      finish = () => failure === "rejected" ? reject(new Error("Offline")) : resolve({ ok: false });
    }));
    render(<NotificationInboxButton initialInbox={inbox} timeZone="America/New_York" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: /Household reminder/ }));
    await act(async () => finish());
    expect(mocks.push).toHaveBeenCalledWith(inbox.items[0].deepLink);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Notification history could not be updated");
    expect(screen.getByLabelText("Unread")).toBeInTheDocument();
  });

  it("retains unread notifications after a failed mark-all and allows retry", async () => {
    mocks.markRead.mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ ok: true });
    render(<NotificationInboxButton initialInbox={inbox} timeZone="America/New_York" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Please try again");
    expect(screen.getByRole("button", { name: "Notifications, 1 unread" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.markRead).toHaveBeenCalledTimes(2);
  });

  it("does not mark new notifications read when an older mark-all completes", async () => {
    let finish!: (value: { ok: true }) => void;
    mocks.markRead.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<NotificationInboxButton initialInbox={inbox} timeZone="America/New_York" />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications, 1 unread" }));
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.getByRole("button", { name: "Marking read…" })).toBeDisabled();
    const updated = { unreadCount: 2, items: [...inbox.items, { ...inbox.items[0], id: "new", title: "New reminder" }] };
    view.rerender(<NotificationInboxButton initialInbox={updated} timeZone="America/New_York" />);
    await act(async () => finish({ ok: true }));
    expect(screen.getByRole("button", { name: "Notifications, 2 unread" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Unread")).toHaveLength(2);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
});
