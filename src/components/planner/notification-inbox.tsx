"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Bell, CheckCircle2, Clock3, Mail, Smartphone, X } from "lucide-react";
import { markNotificationReadAction } from "@/app/actions/notifications";
import type { NotificationChannelState, NotificationInbox, NotificationInboxItem } from "@/types/domain";

export function NotificationInboxButton({ initialInbox, timeZone }: { initialInbox: NotificationInbox; timeZone: string }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [inbox, setInbox] = useState(initialInbox);
  const [lastInitialInbox, setLastInitialInbox] = useState(initialInbox);
  const [markingAll, setMarkingAll] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const markAllPending = useRef(false);

  if (lastInitialInbox !== initialInbox) {
    setLastInitialInbox(initialInbox);
    setInbox(initialInbox);
  }

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [open]);

  const markAllRead = () => {
    if (markAllPending.current) return;
    markAllPending.current = true;
    setMarkingAll(true);
    setReadError(null);
    const snapshot = inbox;
    startTransition(async () => {
      try {
        const result = await markNotificationReadAction();
        if (!result.ok) throw new Error(result.error);
        const readAt = new Date().toISOString();
        // A refresh may have delivered newer notifications while this save ran.
        setInbox((current) => current === snapshot ? {
          unreadCount: 0,
          items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? readAt })),
        } : current);
        router.refresh();
      } catch {
        setReadError("Notification history could not be updated. Please try again.");
      } finally {
        markAllPending.current = false;
        setMarkingAll(false);
      }
    });
  };

  const openItem = (item: NotificationInboxItem) => {
    setOpen(false);
    if (item.readAt) {
      router.push(safeInboxHref(item.deepLink));
      return;
    }
    setReadError(null);
    startTransition(async () => {
      try {
        const result = await markNotificationReadAction(item.id);
        if (!result.ok) throw new Error(result.error);
        setInbox((current) => {
          if (!current.items.some((candidate) => candidate.id === item.id && !candidate.readAt)) return current;
          return {
            unreadCount: Math.max(0, current.unreadCount - 1),
            items: current.items.map((candidate) => candidate.id === item.id
              ? { ...candidate, readAt: new Date().toISOString() }
              : candidate),
          };
        });
      } catch {
        setReadError("Notification history could not be updated. Please try again.");
      } finally {
        // History failures must not prevent opening the actual reminder.
        // Let the Server Action settle before changing its current route.
        router.push(safeInboxHref(item.deepLink));
      }
    });
  };

  return (
    <div className="notification-inbox" ref={container}>
      <button
        className="topbar-link notification-inbox-trigger"
        type="button"
        aria-label={inbox.unreadCount ? `Notifications, ${inbox.unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="notification-bell"><Bell size={15} />{inbox.unreadCount > 0 && <i>{Math.min(inbox.unreadCount, 99)}</i>}</span>
        <span>Inbox</span>
      </button>
      {open && (
        <section className="notification-inbox-panel" role="dialog" aria-label="Notification history">
          <header>
            <span><strong>Notifications</strong><small>Recent reminders and household activity</small></span>
            <span>
              {inbox.unreadCount > 0 && <button type="button" disabled={markingAll} onClick={markAllRead}>{markingAll ? "Marking read…" : "Mark all read"}</button>}
              <button className="notification-inbox-close" type="button" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={15} /></button>
            </span>
          </header>
          {readError && <p className="location-picker-error" role="alert">{readError}</p>}
          {inbox.items.length ? (
            <div className="notification-inbox-list">
              {inbox.items.map((item) => (
                <article className={item.readAt ? "" : "is-unread"} key={item.id}>
                  <button className="notification-inbox-item" type="button" onClick={() => openItem(item)}>
                    <span className="notification-kind-icon"><NotificationKindIcon kind={item.kind} /></span>
                    <span className="notification-inbox-copy">
                      <span><strong>{item.title}</strong>{!item.readAt && <i aria-label="Unread" />}</span>
                      <small>{item.body}</small>
                      <time dateTime={item.createdAt}>{formatInboxDate(item.createdAt, timeZone)}</time>
                    </span>
                  </button>
                  <div className="notification-channel-states" aria-label="Delivery status">
                    <ChannelState icon={<Mail size={11} />} label="Email" state={item.channels.email} />
                    <ChannelState icon={<Smartphone size={11} />} label="Push" state={item.channels.push} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="notification-inbox-empty"><Bell size={20} /><strong>You’re all caught up</strong><span>Reminders and household updates will appear here.</span></div>
          )}
        </section>
      )}
    </div>
  );
}

function NotificationKindIcon({ kind }: { kind: NotificationInboxItem["kind"] }) {
  if (kind === "reminder") return <Clock3 size={15} />;
  if (kind === "household_change") return <CheckCircle2 size={15} />;
  return <Bell size={15} />;
}

function ChannelState({ icon, label, state }: { icon: ReactNode; label: string; state: NotificationChannelState }) {
  const status = state.status === "delivered"
    ? "Delivered"
    : state.status === "skipped"
      ? "Off"
      : state.status === "failed" && state.attempts >= 5
        ? "Failed"
        : state.status === "failed"
          ? "Retrying"
          : "Queued";
  const isError = status === "Failed";
  return (
    <span className={isError ? "is-error" : ""} title={state.lastError ?? `${label}: ${status}`}>
      {isError ? <AlertTriangle size={11} /> : icon}{label} · {status}
    </span>
  );
}

function safeInboxHref(value: string): string {
  return /^\/(?!\/)/.test(value) ? value : "/planner";
}

function formatInboxDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(value));
}
