import Foundation

enum PreviewData {
    static let user = SessionIdentity(userId: "demo-jim", email: "jim@example.com", displayName: "Jim", avatarUrl: nil, householdId: "demo-household", role: "owner")

    static let categories = [
        PlanningCategory(id: "10000000-0000-4000-8000-000000000001", name: "Meals", color: "#B87946"),
        PlanningCategory(id: "10000000-0000-4000-8000-000000000002", name: "Kids", color: "#8A759F"),
        PlanningCategory(id: "10000000-0000-4000-8000-000000000004", name: "Errands", color: "#77756E"),
        PlanningCategory(id: "10000000-0000-4000-8000-000000000005", name: "Social", color: "#B06F65"),
    ]

    static var planner: WeeklyPlannerData { planner(weekStart: WeekDate.string(WeekDate.monday())) }

    static func planner(weekStart: String) -> WeeklyPlannerData {
        let east = HouseholdLocation(id: "20000000-0000-4000-8000-000000000001", name: "East Hampton", latitude: 40.96, longitude: -72.18, timezone: "America/New_York", isSaved: true, isDefault: true)
        let city = HouseholdLocation(id: "20000000-0000-4000-8000-000000000002", name: "Manhattan", latitude: 40.71, longitude: -74.0, timezone: "America/New_York", isSaved: true, isDefault: false)
        let dayNames = ["Camp", "Amber Waves Farm", "Camp", "Team meeting", "Camp", "Dinner · Nick & Sarah", "Brunch"]
        let plans = ["Dinner: Pasta", "Pool after quiet time", "Dinner: Thai", "Dinner: Leftovers", "Drive out after lunch", "Maybe Wölffer in the afternoon", "Easy morning at home"]
        let tasks = ["Groceries", "", "Pack Miriam’s bag", "Pick up dry cleaning", "Bring stroller", "Confirm dinner reservation", ""]
        let days = (0..<7).map { index -> DayPlan in
            let date = WeekDate.addDays(index, to: weekStart)
            let location = index == 3 ? city : east
            let start = Calendar.current.date(byAdding: .day, value: index, to: WeekDate.parse(weekStart)) ?? Date()
            let eventStart = Calendar.current.date(bySettingHour: index == 5 ? 19 : 9, minute: index == 6 ? 30 : 15, second: 0, of: start) ?? start
            let eventEnd = Calendar.current.date(byAdding: .hour, value: index == 5 ? 2 : 1, to: eventStart) ?? eventStart
            let event = CalendarEvent(id: "event-\(index)", providerEventId: "provider-\(index)", sourceUserId: "demo-jim", calendarPreferenceId: "calendar-family", etag: "etag", recurringEventId: nil, originalStartTime: nil, canEdit: true, title: dayNames[index], description: index == 0 ? "Camp drop-off and morning activities." : nil, location: location.name, googleUrl: nil, start: WeekDate.iso8601.string(from: eventStart), end: WeekDate.iso8601.string(from: eventEnd), allDay: false, calendarId: "family", calendarName: "Family", calendarAlias: "Family", calendarColor: "#688173", attribution: "FA", sectionGroup: "critical", isConflict: false)
            let supplementalEvent = CalendarEvent(id: "supplemental-\(index)", providerEventId: "personal-\(index)", sourceUserId: "demo-jim", calendarPreferenceId: nil, etag: nil, recurringEventId: nil, originalStartTime: nil, canEdit: false, title: "Personal focus time", description: nil, location: nil, googleUrl: nil, start: WeekDate.iso8601.string(from: eventEnd), end: WeekDate.iso8601.string(from: Calendar.current.date(byAdding: .minute, value: 45, to: eventEnd) ?? eventEnd), allDay: false, calendarId: "personal", calendarName: "Jim", calendarAlias: "Jim", calendarColor: "#587F9B", attribution: "JG", sectionGroup: "supplemental", isConflict: false)
            var items = [PlanningItem(id: "plan-\(index)", planningDate: date, weekStartDate: weekStart, type: .note, categoryId: categories[0].id, categoryName: categories[0].name, categoryColor: categories[0].color, text: plans[index], isCompleted: false, sortOrder: 0, createdBy: "demo-jim", createdByName: "Jim", updatedAt: WeekDate.iso8601.string(from: Date()), saveState: "saved")]
            if !tasks[index].isEmpty { items.append(PlanningItem(id: "task-\(index)", planningDate: date, weekStartDate: weekStart, type: .task, categoryId: categories[2].id, categoryName: categories[2].name, categoryColor: categories[2].color, text: tasks[index], isCompleted: false, sortOrder: 1, createdBy: "demo-jim", createdByName: "Jim", updatedAt: WeekDate.iso8601.string(from: Date()), saveState: "saved")) }
            let rainChance = index == 3 ? 54 : index == 5 ? 72 : 8 + index * 3
            let weather = DailyWeather(date: date, locationId: location.id, conditionCode: index == 2 || index == 3 || index == 5 ? 61 : 0, highF: Double(82 - index), lowF: Double(66 + index % 3), precipitationProbability: rainChance, precipitationAmount: index == 3 ? 0.08 : index == 5 ? 0.18 : 0, windSpeedMph: 8, sunrise: WeekDate.iso8601.string(from: start), sunset: WeekDate.iso8601.string(from: start), hourly: [], status: "available", errorMessage: nil)
            return DayPlan(date: date, location: location, weather: weather, events: index == 3 ? [event, supplementalEvent] : [event], items: items)
        }
        return WeeklyPlannerData(
            household: HouseholdSummary(id: "demo-household", name: "The Greco Family", timezone: "America/New_York", temperatureUnit: .fahrenheit),
            members: [
                HouseholdMember(id: "member-jim", userId: "demo-jim", displayName: "Jim", email: "jim@example.com", role: "owner"),
                HouseholdMember(id: "member-rachel", userId: "demo-rachel", displayName: "Rachel", email: "rachel@example.com", role: "member"),
            ],
            weekStart: weekStart,
            days: days,
            weeklyItems: [PlanningItem(id: "weekly-1", planningDate: nil, weekStartDate: weekStart, type: .task, categoryId: categories[2].id, categoryName: "Errands", categoryColor: categories[2].color, text: "Order groceries", isCompleted: false, sortOrder: 0, createdBy: "demo-jim", createdByName: "Jim", updatedAt: WeekDate.iso8601.string(from: Date()), saveState: "saved")],
            locations: [east, city],
            categories: categories,
            editableCalendars: [
                EditableCalendar(id: "calendar-family", name: "Family", color: "#688173", sectionGroup: "critical"),
                EditableCalendar(id: "calendar-personal", name: "Jim", color: "#587F9B", sectionGroup: "supplemental"),
            ],
            calendarState: PlannerSourceState(status: "ready", message: nil),
            weatherState: PlannerSourceState(status: "ready", message: nil),
            isDemo: true
        )
    }
}
