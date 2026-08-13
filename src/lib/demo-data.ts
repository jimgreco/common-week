import { addDateDays, currentWeekStart, weekDates } from "@/lib/date";
import { calendarAbbreviation } from "@/lib/calendar-utils";
import type {
  CalendarEvent,
  DailyWeather,
  HouseholdLocation,
  PlanningCategory,
  PlanningItem,
  WeeklyPlannerData,
} from "@/types/domain";

export const DEMO_CATEGORIES: PlanningCategory[] = [
  { id: "meals", name: "Meals", color: "#b87946" },
  { id: "kids", name: "Kids", color: "#8a759f" },
  { id: "house", name: "House", color: "#66867b" },
  { id: "errands", name: "Errands", color: "#77756e" },
  { id: "social", name: "Social", color: "#b06f65" },
  { id: "travel", name: "Travel", color: "#657e9a" },
  { id: "todo", name: "To Do", color: "#9a845d" },
  { id: "other", name: "Other", color: "#85827c" },
];

const locations: HouseholdLocation[] = [
  {
    id: "demo-manhattan",
    name: "Manhattan",
    latitude: 40.7831,
    longitude: -73.9712,
    timezone: "America/New_York",
    isSaved: true,
    isDefault: true,
  },
  {
    id: "demo-east-hampton",
    name: "East Hampton",
    latitude: 40.9634,
    longitude: -72.1848,
    timezone: "America/New_York",
    isSaved: true,
  },
];

const category = (id: string) => DEMO_CATEGORIES.find((item) => item.id === id)!;

function planningItem(
  id: string,
  weekStart: string,
  date: string | null,
  text: string,
  type: "note" | "task",
  categoryId: string,
  completed = false,
): PlanningItem {
  const selectedCategory = category(categoryId);
  return {
    id,
    planningDate: date,
    weekStartDate: weekStart,
    type,
    categoryId,
    categoryName: selectedCategory.name,
    categoryColor: selectedCategory.color,
    text,
    isCompleted: completed,
    sortOrder: 0,
    createdBy: "demo-rachel",
    createdByName: "Rachel",
    updatedAt: new Date().toISOString(),
    saveState: "saved",
  };
}

function weatherFor(date: string, locationId: string, index: number): DailyWeather {
  const rainy = index === 2 || index === 5;
  const high = [82, 84, 78, 81, 80, 76, 79][index];
  const low = [66, 68, 67, 69, 67, 68, 66][index];
  const precipitation = rainy ? (index === 5 ? 72 : 58) : [5, 10, 12, 8, 18, 72, 22][index];
  const hourly = Array.from({ length: 12 }, (_, hourIndex) => {
    const hour = hourIndex + 7;
    return {
      time: `${date}T${String(hour).padStart(2, "0")}:00:00`,
      temperatureF: Math.round(low + (high - low) * Math.sin(((hour - 6) / 14) * Math.PI)),
      precipitationProbability: rainy && hour > 12 ? Math.min(90, precipitation + hourIndex * 2) : precipitation,
      precipitationAmount: rainy && hour > 12 ? 0.08 : 0,
      windSpeedMph: 7 + (hourIndex % 4),
      conditionCode: rainy ? 61 : index === 6 ? 2 : 0,
    };
  });

  return {
    date,
    locationId,
    conditionCode: rainy ? 61 : index === 6 ? 2 : 0,
    highF: high,
    lowF: low,
    precipitationProbability: precipitation,
    precipitationAmount: rainy ? 0.31 : 0,
    windSpeedMph: 10,
    sunrise: `${date}T06:04:00`,
    sunset: `${date}T19:52:00`,
    hourly,
    status: "available",
  };
}

function event(
  id: string,
  date: string,
  hour: number,
  minute: number,
  title: string,
  owner: "J" | "R" | "M" | "F",
  duration = 60,
): CalendarEvent {
  const start = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-04:00`);
  const end = new Date(start.getTime() + duration * 60_000);
  const colors = { J: "#587f9b", R: "#a76f67", M: "#88729d", F: "#688173" };
  const names = { J: "Jim", R: "Rachel", M: "Miriam", F: "Family" };
  return {
    id,
    providerEventId: id,
    sourceUserId: owner === "R" ? "demo-rachel" : "demo-jim",
    calendarPreferenceId: `demo-${owner}`,
    etag: `demo-${id}`,
    canEdit: owner === "J" || owner === "F",
    title,
    description: id === "e1" ? "Camp drop-off and morning activities." : undefined,
    location: owner === "F" ? "East Hampton, New York" : owner === "M" ? "Miriam's school" : undefined,
    start: start.toISOString(),
    end: end.toISOString(),
    allDay: false,
    calendarId: `demo-${owner}`,
    calendarName: names[owner],
    calendarAlias: names[owner],
    calendarColor: colors[owner],
    attribution: calendarAbbreviation(names[owner]),
    sectionGroup: owner === "J" || owner === "R" ? "supplemental" : "critical",
  };
}

export function getDemoPlannerData(requestedWeek?: string): WeeklyPlannerData {
  const weekStart = requestedWeek ?? currentWeekStart();
  const dates = weekDates(weekStart);
  const todayWeek = currentWeekStart();
  const isCurrent = weekStart === todayWeek;

  const dailyItems: PlanningItem[][] = isCurrent
    ? [
        [
          planningItem("demo-p1", weekStart, dates[0], "Dinner: Pasta", "note", "meals"),
          planningItem("demo-p2", weekStart, dates[0], "Library after camp", "note", "kids"),
          planningItem("demo-t1", weekStart, dates[0], "Groceries", "task", "errands"),
        ],
        [
          planningItem("demo-p3", weekStart, dates[1], "Dinner: Tacos", "note", "meals"),
          planningItem("demo-p4", weekStart, dates[1], "Pool after quiet time", "note", "kids"),
          planningItem("demo-p5", weekStart, dates[1], "Pool guy 11–2", "note", "house"),
        ],
        [
          planningItem("demo-p6", weekStart, dates[2], "Dinner: Thai", "note", "meals"),
          planningItem("demo-t2", weekStart, dates[2], "Pack Miriam’s bag", "task", "travel"),
        ],
        [
          planningItem("demo-p7", weekStart, dates[3], "Dinner: Leftovers", "note", "meals"),
          planningItem("demo-t3", weekStart, dates[3], "Pick up dry cleaning", "task", "errands"),
        ],
        [
          planningItem("demo-p8", weekStart, dates[4], "Drive out after lunch", "note", "travel"),
          planningItem("demo-t4", weekStart, dates[4], "Bring stroller", "task", "travel"),
        ],
        [
          planningItem("demo-p9", weekStart, dates[5], "Maybe Wölffer in the afternoon", "note", "social"),
          planningItem("demo-t5", weekStart, dates[5], "Confirm dinner reservation", "task", "social"),
        ],
        [planningItem("demo-p10", weekStart, dates[6], "Easy morning at home", "note", "other")],
      ]
    : dates.map(() => []);

  const calendarEvents = isCurrent
    ? [
        [event("e1", dates[0], 9, 15, "Camp", "M"), event("e2", dates[0], 13, 0, "Workout", "J"), event("e3", dates[0], 16, 0, "Library", "F")],
        [event("e4", dates[1], 10, 0, "Amber Waves Farm", "F", 90), event("e5", dates[1], 13, 0, "Workout", "R")],
        [event("e6", dates[2], 9, 15, "Camp", "M"), event("e7", dates[2], 16, 0, "Beach", "F", 120)],
        [event("e8", dates[3], 10, 0, "Team meeting", "R"), event("e9", dates[3], 13, 0, "Workout", "J")],
        [event("e10", dates[4], 9, 15, "Camp", "M"), event("e11", dates[4], 12, 30, "Dentist", "J")],
        [event("e12", dates[5], 11, 0, "Tennis", "R"), event("e13", dates[5], 19, 0, "Dinner · Nick & Sarah", "F", 120)],
        [event("e14", dates[6], 10, 30, "Brunch", "F", 90)],
      ]
    : dates.map(() => []);

  const weeklyItems = isCurrent
    ? [
        planningItem("demo-w1", weekStart, null, "Confirm Saturday sitter", "task", "todo"),
        planningItem("demo-w2", weekStart, null, "Order groceries", "task", "errands"),
        planningItem("demo-w3", weekStart, null, "Decide Saturday dinner", "task", "meals"),
        planningItem("demo-w4", weekStart, null, "Guests arriving Saturday afternoon.", "note", "social"),
      ]
    : [];

  return {
    household: {
      id: "demo-household",
      name: "The Greco Family",
      timezone: "America/New_York",
      temperatureUnit: "fahrenheit",
    },
    members: [
      { id: "m1", userId: "demo-jim", displayName: "Jim", email: "jim@example.com", role: "owner" },
      { id: "m2", userId: "demo-rachel", displayName: "Rachel", email: "rachel@example.com", role: "member" },
    ],
    weekStart,
    days: dates.map((date, index) => {
      const inEastHampton = index < 3 || index > 3;
      const location = inEastHampton ? locations[1] : locations[0];
      return {
        date,
        location,
        weather: weatherFor(date, location.id, index),
        events: calendarEvents[index],
        items: dailyItems[index],
      };
    }),
    weeklyItems,
    locations,
    categories: DEMO_CATEGORIES,
    calendarState: { status: "ready" },
    weatherState: { status: "ready" },
    editableCalendars: [
      { id: "demo-F", name: "Family", color: "#688173", sectionGroup: "critical" },
      { id: "demo-J", name: "Jim", color: "#587f9b", sectionGroup: "supplemental" },
    ],
    isDemo: true,
  };
}

export function getNextDemoWeek(): string {
  return addDateDays(currentWeekStart(), 7);
}
