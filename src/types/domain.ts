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

export interface PlanningCategory {
  id: string;
  name: string;
  color: string;
}

export interface PlanningItem {
  id: string;
  planningDate: string | null;
  weekStartDate: string;
  type: PlanningItemType;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  text: string;
  isCompleted: boolean;
  sortOrder: number;
  createdBy: string;
  createdByName?: string;
  updatedAt: string;
  saveState?: SaveState;
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
}

export type CalendarSectionGroup = "critical" | "supplemental";

export type GoogleCalendarAccessRole =
  | "freeBusyReader"
  | "reader"
  | "writer"
  | "owner";

export interface EditableCalendar {
  id: string;
  name: string;
  color: string;
  sectionGroup: CalendarSectionGroup;
}

export interface CalendarEventDraft {
  requestId: string;
  calendarPreferenceId: string;
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
}

export interface HiddenCalendarEvent {
  id: string;
  eventId: string;
  title: string;
  calendarName: string;
  eventStart: string;
  hiddenAt: string;
}

export interface CalendarPreference {
  id: string;
  userId: string;
  googleCalendarId: string;
  calendarName: string;
  displayAlias: string | null;
  displayAbbreviation: string | null;
  color: string;
  isSelected: boolean;
  isPrimary: boolean;
  sectionGroup: CalendarSectionGroup;
  accessRole: GoogleCalendarAccessRole;
}

export interface DayPlan {
  date: string;
  location: HouseholdLocation | null;
  weather: DailyWeather | null;
  events: CalendarEvent[];
  items: PlanningItem[];
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
  categories: PlanningCategory[];
  editableCalendars: EditableCalendar[];
  calendarState: PlannerSourceState;
  weatherState: PlannerSourceState;
  isDemo: boolean;
}

export interface PlannerSourcePayload {
  days: Array<Pick<DayPlan, "date" | "events" | "weather">>;
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

export interface ActionResult<T = undefined> {
  ok: boolean;
  data?: T;
  error?: string;
}
