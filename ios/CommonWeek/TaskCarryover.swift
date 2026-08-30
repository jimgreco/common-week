import Foundation

extension PlanningItem {
    var carryoverLabel: String? {
        guard (carryoverCount ?? 0) > 0 else { return nil }
        if let originalPlanningDate {
            return "Carried from \(WeekDate.longDay(originalPlanningDate))"
        }
        if let originalWeekStartDate {
            return "Carried from week of \(WeekDate.weekTitle(originalWeekStartDate))"
        }
        return "Carried over"
    }

    mutating func carry(to planningDate: String?, weekStart: String, at now: Date) {
        let priorDate = self.planningDate
        let priorWeek = weekStartDate
        if originalWeekStartDate == nil { originalWeekStartDate = priorWeek }
        if originalPlanningDate == nil, let priorDate { originalPlanningDate = priorDate }
        let distance = priorDate.map { WeekDate.daysBetween($0, planningDate ?? $0) }
            ?? max(0, WeekDate.daysBetween(priorWeek, weekStart) / 7)
        carryoverCount = (carryoverCount ?? 0) + max(0, distance)
        lastCarriedAt = WeekDate.iso8601.string(from: now)
        self.planningDate = planningDate
        weekStartDate = weekStart
    }
}

extension WeeklyPlannerData {
    func carryingOpenTasks(to today: String, at now: Date = Date()) -> WeeklyPlannerData {
        let targetWeek = WeekDate.weekStart(for: today)
        guard targetWeek >= weekStart else { return self }

        var carriedDaily: [PlanningItem] = []
        var retainedDays = days
        for dayIndex in retainedDays.indices {
            retainedDays[dayIndex].items.removeAll { item in
                guard item.type == .task,
                      !item.isCompleted,
                      let planningDate = item.planningDate,
                      planningDate < today else { return false }
                var carried = item
                carried.carry(to: today, weekStart: targetWeek, at: now)
                carriedDaily.append(carried)
                return true
            }
        }

        var carriedWeekly: [PlanningItem] = []
        var retainedWeekly = weeklyItems.filter { item in
            guard item.type == .task, !item.isCompleted, item.weekStartDate < targetWeek else { return true }
            var carried = item
            carried.carry(to: nil, weekStart: targetWeek, at: now)
            carriedWeekly.append(carried)
            return false
        }

        if targetWeek != weekStart {
            retainedDays = (0..<7).map { offset in
                DayPlan(
                    date: WeekDate.addDays(offset, to: targetWeek),
                    location: nil,
                    weather: nil,
                    memberLocations: members.map { DayMemberLocation(memberId: $0.id, userId: $0.userId, displayName: $0.displayName, location: nil, weather: nil) },
                    events: [],
                    items: []
                )
            }
            retainedWeekly = []
        }

        if let todayIndex = retainedDays.firstIndex(where: { $0.date == today }) {
            retainedDays[todayIndex].items.append(contentsOf: carriedDaily)
        }
        retainedWeekly.append(contentsOf: carriedWeekly)

        return WeeklyPlannerData(
            household: household,
            members: members,
            weekStart: targetWeek,
            days: retainedDays,
            weeklyItems: retainedWeekly,
            locations: locations,
            editableCalendars: editableCalendars,
            calendarState: calendarState,
            weatherState: weatherState,
            isDemo: isDemo
        )
    }
}
