import Foundation

struct CalendarTimeSlot: Equatable {
    let date: String
    let minute: Int?
    static func snapped(date: String, minute: Double) -> Self {
        let rounded = Int((minute / 15).rounded()) * 15
        return Self(date: WeekDate.addDays(Int(floor(Double(rounded) / 1440)), to: date), minute: ((rounded % 1440) + 1440) % 1440)
    }
    var label: String { "\(date) · \(minute.map { String(format: "%02d:%02d", $0 / 60, $0 % 60) } ?? "All day")" }
}

enum CalendarInteraction {
    struct InvalidTime: LocalizedError { let message: String; var errorDescription: String? { message } }
    static func dayDifference(_ start: String, _ end: String) -> Int {
        Int((WeekDate.calendarDate(end, timeZoneIdentifier: "UTC").timeIntervalSince(WeekDate.calendarDate(start, timeZoneIdentifier: "UTC")) / 86400).rounded())
    }
    static func instant(_ slot: CalendarTimeSlot, timezone: String) throws -> Date {
        let calendar = CalendarTimelineLayout.calendar(timezone)
        let day = WeekDate.calendarDate(slot.date, timeZoneIdentifier: timezone)
        var parts = calendar.dateComponents([.year, .month, .day], from: day)
        parts.hour = (slot.minute ?? 540) / 60; parts.minute = (slot.minute ?? 540) % 60; parts.second = 0
        guard let date = calendar.date(from: parts), WeekDate.string(date, timeZoneIdentifier: timezone) == slot.date,
              Int(CalendarTimelineLayout.minute(date, timezone: timezone)) == slot.minute ?? 540 else {
            throw InvalidTime(message: "That time does not exist because the clocks change. Choose another time.")
        }
        return date
    }
    static func canMove(_ event: CalendarEvent) -> Bool {
        event.canEdit == true && event.calendarPreferenceId != nil && event.providerEventId != nil && event.etag != nil
    }
    static func moveDraft(_ event: CalendarEvent, to slot: CalendarTimeSlot, timezone: String) throws -> CalendarEventDraft {
        guard canMove(event), let calendarId = event.calendarPreferenceId else { throw InvalidTime(message: "This event cannot be moved. Refresh the calendar or open its details.") }
        guard event.allDay == (slot.minute == nil) else { throw InvalidTime(message: "Move all-day events within the all-day row, and timed events within the hours.") }
        let startDate: String, endDate: String, startTime: String, endTime: String
        if event.allDay {
            let days = dayDifference(String(event.start.prefix(10)), String(event.end.prefix(10)))
            guard days > 0 else { throw InvalidTime(message: "Refresh this event before moving it.") }
            startDate = slot.date; endDate = WeekDate.addDays(days - 1, to: slot.date); startTime = "09:00"; endTime = "10:00"
        } else {
            guard let originalStart = PlannerMoment.date(from: event.start), let originalEnd = PlannerMoment.date(from: event.end), originalEnd > originalStart else { throw InvalidTime(message: "Refresh this event before moving it.") }
            let start = try instant(slot, timezone: timezone), end = start.addingTimeInterval(originalEnd.timeIntervalSince(originalStart))
            startDate = WeekDate.string(start, timeZoneIdentifier: timezone); endDate = WeekDate.string(end, timeZoneIdentifier: timezone)
            let time = DateFormatter(); time.locale = Locale(identifier: "en_US_POSIX"); time.timeZone = TimeZone(identifier: timezone); time.dateFormat = "HH:mm"
            startTime = time.string(from: start); endTime = time.string(from: end)
            let roundTrip = try instant(CalendarTimeSlot(date: endDate, minute: Int(CalendarTimelineLayout.minute(end, timezone: timezone))), timezone: timezone)
            guard abs(roundTrip.timeIntervalSince(end)) < 1 else { throw InvalidTime(message: "This event’s exact duration cannot be preserved at that time. Open the event to choose its times.") }
        }
        return CalendarEventDraft(requestId: UUID().uuidString, calendarPreferenceId: calendarId, sourceCalendarPreferenceId: calendarId, providerEventId: event.providerEventId, etag: event.etag,
            title: event.title, description: event.description ?? "", location: event.location ?? "", allDay: event.allDay, startDate: startDate, endDate: endDate, startTime: startTime, endTime: endTime,
            recurringEventId: event.recurringEventId, recurringScope: event.recurringEventId == nil ? nil : "occurrence", recurrence: nil, guestEmails: nil)
    }
    static func applyingDemo(_ draft: CalendarEventDraft, to planner: WeeklyPlannerData) throws -> WeeklyPlannerData {
        var planner = planner
        guard let calendar = planner.editableCalendars.first(where: { $0.id == draft.calendarPreferenceId }) else { throw InvalidTime(message: "Choose an editable calendar.") }
        let prior = planner.days.flatMap(\.events).first { $0.providerEventId == draft.providerEventId && $0.calendarPreferenceId == (draft.sourceCalendarPreferenceId ?? draft.calendarPreferenceId) }
        func minute(_ text: String) -> Int { let parts = text.split(separator: ":").compactMap { Int($0) }; return (parts.first ?? 9) * 60 + (parts.last ?? 0) }
        let start = draft.allDay ? draft.startDate : WeekDate.iso8601.string(from: try instant(CalendarTimeSlot(date: draft.startDate, minute: minute(draft.startTime)), timezone: planner.household.timezone))
        let end = draft.allDay ? WeekDate.addDays(1, to: draft.endDate) : WeekDate.iso8601.string(from: try instant(CalendarTimeSlot(date: draft.endDate, minute: minute(draft.endTime)), timezone: planner.household.timezone))
        guard end > start else { throw InvalidTime(message: "End time must be after the start time.") }
        let event = CalendarEvent(id: prior?.id ?? UUID().uuidString, providerEventId: prior?.providerEventId ?? UUID().uuidString, sourceUserId: prior?.sourceUserId ?? calendar.sourceUserId,
            calendarPreferenceId: calendar.id, etag: UUID().uuidString, recurringEventId: prior?.recurringEventId, originalStartTime: prior?.originalStartTime, canEdit: true,
            title: draft.title, description: draft.description, location: draft.location, googleUrl: prior?.googleUrl, start: start, end: end, allDay: draft.allDay,
            calendarId: prior?.calendarId ?? calendar.id, calendarName: calendar.name, calendarAlias: calendar.name, calendarColor: calendar.color, attribution: prior?.attribution ?? "Family", sectionGroup: calendar.sectionGroup,
            isConflict: false, attendees: prior?.attendees, canRespond: prior?.canRespond, reminder: prior?.reminder, assignedAdultUserIds: prior?.assignedAdultUserIds, assignedMemberIds: prior?.assignedMemberIds,
            defaultMemberIds: prior?.defaultMemberIds, memberOverrideIds: prior?.memberOverrideIds)
        for index in planner.days.indices {
            let date = planner.days[index].date
            planner.days[index].events.removeAll { $0.id == event.id }
            let visible = draft.allDay ? date >= start && date < end : !CalendarTimelineLayout.blocks(events: [event], date: date, timezone: planner.household.timezone).isEmpty
            if visible { planner.days[index].events.append(event) }
        }
        return planner
    }
}
