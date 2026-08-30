export type PlanningItemType = "note" | "task";

export type SaveState = "saved" | "saving" | "failed";

export interface HouseholdSummary {
  id: string;
  name: string;
  timezone: string;
  temperatureUnit: "fahrenheit" | "celsius";
}

export interface HouseholdMember {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  role: "owner" | "member" | "viewer";
}

export interface PlanningItem {
  id: string;
  planningDate: string | null;
  weekStartDate: string;
  type: PlanningItemType;
  text: string;
  isCompleted: boolean;
  sortOrder: number;
  createdBy: string;
  createdByName?: string;
  updatedAt: string;
  originalPlanningDate?: string | null;
  originalWeekStartDate?: string;
  carryoverCount?: number;
  lastCarriedAt?: string | null;
  saveState?: SaveState;
  reminder?: NotificationReminder | null;
}

export interface NotificationReminder {
  id: string;
  resourceKind: "planning_item" | "calendar_event";
  remindAt: string;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  pushEnabled: boolean;
  morningDigestEnabled: boolean;
  morningDigestTime: string;
  sundayPlanningEnabled: boolean;
  sundayPlanningTime: string;
  householdChangeAlerts: boolean;
}

export type NotificationDeliveryStatus = "pending" | "sending" | "delivered" | "failed" | "skipped";

export interface NotificationChannelState {
  status: NotificationDeliveryStatus;
  attempts: number;
  deliveredAt: string | null;
  lastError: string | null;
}

export type NotificationInboxTarget =
  | { kind: "planner"; weekStart: string }
  | { kind: "planning_item"; weekStart: string; planningItemId: string }
  | { kind: "calendar_event"; weekStart: string; calendarPreferenceId: string; providerEventId: string };

export interface NotificationInboxItem {
  id: string;
  kind: "reminder" | "morning_digest" | "sunday_planning" | "household_change";
  title: string;
  body: string;
  deepLink: string;
  scheduledFor: string;
  createdAt: string;
  readAt: string | null;
  channels: {
    email: NotificationChannelState;
    push: NotificationChannelState;
  };
  target: NotificationInboxTarget | null;
}

export interface NotificationInbox {
  items: NotificationInboxItem[];
  unreadCount: number;
}

export interface HouseholdLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  timezone: string;
  isSaved: boolean;
  isDefault?: boolean;
}

export interface HourlyWeather {
  time: string;
  temperatureF: number;
  precipitationProbability: number;
  precipitationAmount: number;
  windSpeedMph: number;
  conditionCode: number;
}

export interface DailyWeather {
  date: string;
  locationId: string;
  conditionCode: number;
  highF: number;
  lowF: number;
  precipitationProbability: number;
  precipitationAmount: number;
  windSpeedMph: number;
  sunrise: string;
  sunset: string;
  hourly: HourlyWeather[];
  status: "available" | "unavailable" | "error";
  errorMessage?: string;
}

export interface CalendarEvent {
  id: string;
  providerEventId?: string;
  sourceUserId?: string;
  calendarPreferenceId?: string;
  etag?: string;
  recurringEventId?: string;
  originalStartTime?: string;
  canEdit?: boolean;
  title: string;
  description?: string;
  location?: string;
  googleUrl?: string;
  start: string;
  end: string;
  allDay: boolean;
  calendarId: string;
  calendarName: string;
  calendarAlias: string;
  calendarColor: string;
  attribution: string;
  sectionGroup: CalendarSectionGroup;
  isConflict?: boolean;
  attendees?: CalendarAttendee[];
  canRespond?: boolean;
  reminder?: NotificationReminder | null;
}

export type CalendarResponseStatus = "needsAction" | "declined" | "tentative" | "accepted";

export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus: CalendarResponseStatus;
  self?: boolean;
  organizer?: boolean;
}

export type CalendarSectionGroup = "critical" | "supplemental";

export type GoogleCalendarAccessRole =
  | "freeBusyReader"
  | "reader"
  | "writer"
  | "owner";

export interface EditableCalendar {
  id: string;
  sourceUserId?: string;
  name: string;
  color: string;
  sectionGroup: CalendarSectionGroup;
}

export interface CalendarEventDraft {
  requestId: string;
  calendarPreferenceId: string;
  sourceCalendarPreferenceId?: string;
  providerEventId?: string;
  etag?: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  recurringEventId?: string;
  recurringScope?: "occurrence" | "series";
}

export type PlannerSearchResult =
  | { kind: "planning_item"; item: PlanningItem }
  | { kind: "calendar_event"; event: CalendarEvent };

export interface HiddenCalendarEvent {
  id: string;
  eventId: string;
  title: string;
  calendarName: string;
  eventStart: string;
  hiddenAt: string;
}

export type CalendarVisibility = "hide" | "private" | "share";

export interface CalendarPreference {
  id: string;
  userId: string;
  googleCalendarId: string;
  calendarName: string;
  displayAlias: string | null;
  displayAbbreviation: string | null;
  color: string;
  visibility: CalendarVisibility;
  isPrimary: boolean;
  sectionGroup: CalendarSectionGroup;
  accessRole: GoogleCalendarAccessRole;
}

export interface DayPlan {
  date: string;
  location: HouseholdLocation | null;
  weather: DailyWeather | null;
  memberLocations: DayMemberLocation[];
  events: CalendarEvent[];
  items: PlanningItem[];
}

export interface DayMemberLocation {
  memberId: string;
  userId: string;
  displayName: string;
  location: HouseholdLocation | null;
  weather: DailyWeather | null;
}

export interface PlannerSourceState {
  status: "ready" | "loading" | "error" | "not-connected";
  message?: string;
}

export interface WeeklyPlannerData {
  household: HouseholdSummary;
  members: HouseholdMember[];
  weekStart: string;
  days: DayPlan[];
  weeklyItems: PlanningItem[];
  locations: HouseholdLocation[];
  editableCalendars: EditableCalendar[];
  calendarState: PlannerSourceState;
  weatherState: PlannerSourceState;
  isDemo: boolean;
}

export interface PlannerSourcePayload {
  days: Array<Pick<DayPlan, "date" | "events" | "location" | "weather" | "memberLocations">>;
  calendarState: PlannerSourceState;
  weatherState: PlannerSourceState;
}

export interface GeocodingResult {
  id: string;
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface EventLocationSuggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
}

export interface ResolvedEventLocation {
  placeId: string;
  location: string;
  formattedAddress: string;
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}
