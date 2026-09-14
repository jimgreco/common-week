import SwiftUI

enum CalendarPresentation: String, CaseIterable, Identifiable {
    case planner = "List", day = "Day", week = "Week"
    var id: String { rawValue }
}

struct CalendarPresentationPicker: View {
    @Binding var selection: CalendarPresentation
    @State private var lastRange: CalendarPresentation = .day
    var body: some View {
        VStack(spacing: 8) {
            Picker("View", selection: Binding(get: { selection != .planner }, set: { selection = $0 ? lastRange : .planner })) {
                Text("List").tag(false)
                Text("Calendar").tag(true)
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("calendar-view-picker")
            if selection != .planner {
                Picker("Calendar range", selection: $selection) {
                    Text("Day").tag(CalendarPresentation.day)
                    Text("Week").tag(CalendarPresentation.week)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("calendar-range-picker")
            }
        }
        .onChange(of: selection) { _, value in if value != .planner { lastRange = value } }
    }
}

struct CalendarTimelineBlock: Identifiable {
    var id: String { event.id }
    let event: CalendarEvent
    let startMinute: Double
    let endMinute: Double
    var column = 0
    var columnCount = 1
    var overlaps = false
}

enum CalendarTimelineLayout {
    static func calendar(_ timezone: String) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: timezone) ?? .current
        return calendar
    }

    static func minute(_ date: Date, timezone: String) -> Double {
        let parts = calendar(timezone).dateComponents([.hour, .minute], from: date)
        return Double((parts.hour ?? 0) * 60 + (parts.minute ?? 0))
    }

    static func blocks(events: [CalendarEvent], date: String, timezone: String) -> [CalendarTimelineBlock] {
        let calendar = calendar(timezone)
        let dayStart = calendar.startOfDay(for: WeekDate.calendarDate(date, timeZoneIdentifier: timezone))
        guard let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) else { return [] }
        var seen = Set<String>()
        var blocks: [CalendarTimelineBlock] = events.compactMap { event in
            guard !event.allDay, seen.insert(event.id).inserted,
                  let start = PlannerMoment.date(from: event.start), let end = PlannerMoment.date(from: event.end),
                  end > start, start < dayEnd, end > dayStart else { return nil }
            let startMinute = start <= dayStart ? 0 : minute(start, timezone: timezone)
            let clockEnd = end >= dayEnd ? 1440 : minute(end, timezone: timezone)
            let endMinute = clockEnd > startMinute ? clockEnd : min(1440, startMinute + min(end, dayEnd).timeIntervalSince(max(start, dayStart)) / 60)
            return CalendarTimelineBlock(event: event, startMinute: startMinute, endMinute: endMinute)
        }.sorted {
            if $0.startMinute != $1.startMinute { return $0.startMinute < $1.startMinute }
            if $0.endMinute != $1.endMinute { return $0.endMinute > $1.endMinute }
            return $0.id < $1.id
        }
        var groupStart = 0
        var columnEnds: [Double] = []
        for index in blocks.indices {
            if !columnEnds.isEmpty && columnEnds.allSatisfy({ $0 <= blocks[index].startMinute }) {
                for previous in groupStart..<index { blocks[previous].columnCount = columnEnds.count }
                groupStart = index
                columnEnds = []
            }
            let column = columnEnds.firstIndex(where: { $0 <= blocks[index].startMinute }) ?? columnEnds.count
            let end = max(blocks[index].endMinute, blocks[index].startMinute + 15)
            if column == columnEnds.count { columnEnds.append(end) } else { columnEnds[column] = end }
            blocks[index].column = column
        }
        for index in groupStart..<blocks.count { blocks[index].columnCount = columnEnds.count }
        for index in blocks.indices {
            let start = PlannerMoment.date(from: blocks[index].event.start)!
            let end = PlannerMoment.date(from: blocks[index].event.end)!
            blocks[index].overlaps = blocks.indices.contains { other in
                other != index && start < PlannerMoment.date(from: blocks[other].event.end)!
                    && PlannerMoment.date(from: blocks[other].event.start)! < end
            }
        }
        return blocks
    }

    static func label(_ event: CalendarEvent, date: String, timezone: String) -> String {
        guard !event.allDay, let start = PlannerMoment.date(from: event.start), let end = PlannerMoment.date(from: event.end) else { return "All day" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = calendar(timezone).timeZone
        let crossesDate = WeekDate.string(start, timeZoneIdentifier: timezone) != date || WeekDate.string(end, timeZoneIdentifier: timezone) != date
        let changesOffset = formatter.timeZone.secondsFromGMT(for: start) != formatter.timeZone.secondsFromGMT(for: end)
        formatter.dateFormat = (crossesDate ? "MMM d, " : "") + "h:mm a" + (changesOffset ? " z" : "")
        return "\(formatter.string(from: start)) – \(formatter.string(from: end))"
    }
}

struct CalendarTimelineView<Footer: View>: View {
    let days: [DayPlan]
    let timezone: String
    let sourceState: PlannerSourceState
    let onEvent: (CalendarEvent) -> Void
    let onDay: (String) -> Void
    @ViewBuilder var footer: () -> Footer
    private let hourHeight: CGFloat = 72
    private let axisWidth: CGFloat = 48
    private var headerHeight: CGFloat { 42 + CGFloat(max(1, days.map { $0.events.filter(\.allDay).count }.max() ?? 1)) * 26 }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Times in \(timezone.replacingOccurrences(of: "_", with: " "))")
                .font(.caption).foregroundStyle(CWTheme.secondaryInk)
            Text("Blank space is open time · Overlaps appear side by side")
                .font(.caption2).foregroundStyle(CWTheme.secondaryInk)
            if sourceState.status != "ready" {
                Text("\(sourceState.message ?? "Loading calendar…") Open time may be incomplete.")
                    .font(.caption).foregroundStyle(CWTheme.secondaryInk)
            } else if days.allSatisfy({ $0.events.isEmpty }) {
                Text("No events in this view. Your visible calendars leave this time open.")
                    .font(.caption).foregroundStyle(CWTheme.secondaryInk)
            }
            VStack(spacing: 0) {
                GeometryReader { geometry in
                    let dayWidth = max(days.count == 1 ? 0 : 136, (geometry.size.width - axisWidth) / CGFloat(max(1, days.count)))
                    ScrollView(.horizontal) {
                        VStack(spacing: 0) {
                            HStack(alignment: .top, spacing: 0) {
                                Text("All day").font(.system(size: 10)).foregroundStyle(CWTheme.secondaryInk)
                                    .frame(width: axisWidth, height: headerHeight, alignment: .bottom).padding(.bottom, 4)
                                ForEach(days) { day in dayHeader(day, width: dayWidth) }
                            }
                            .frame(height: headerHeight)
                            Divider()
                            ScrollViewReader { proxy in
                                ScrollView(.vertical) {
                                    HStack(alignment: .top, spacing: 0) {
                                        VStack(spacing: 0) {
                                            ForEach(0..<24) { hour in
                                                Text(hourLabel(hour)).font(.system(size: 10)).foregroundStyle(CWTheme.secondaryInk)
                                                    .frame(width: axisWidth, height: hourHeight, alignment: .topTrailing)
                                                    .id(hour)
                                            }
                                        }.padding(.trailing, 6).frame(width: axisWidth)
                                        ForEach(days) { day in dayColumn(day, width: dayWidth) }
                                    }
                                }
                                .onAppear { proxy.scrollTo(7, anchor: .top) }
                                .onChange(of: days.map(\.date)) { _, _ in proxy.scrollTo(7, anchor: .top) }
                                .accessibilityIdentifier("calendar-timeline-scroll")
                            }
                        }
                        .frame(width: axisWidth + dayWidth * CGFloat(days.count))
                    }
                }
                footer()
            }
            .frame(height: 540)
            .background(Color(uiColor: .secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay { RoundedRectangle(cornerRadius: 12).stroke(CWTheme.rule, lineWidth: 1) }
        }
        .accessibilityIdentifier("calendar-timeline")
    }

    private func dayHeader(_ day: DayPlan, width: CGFloat) -> some View {
        VStack(spacing: 4) {
            Button { onDay(day.date) } label: {
                Text(WeekDate.shortDay(day.date)).font(.caption.weight(.bold))
                    .foregroundStyle(WeekDate.isToday(day.date, timeZoneIdentifier: timezone) ? CWTheme.brand : CWTheme.ink)
                    .frame(maxWidth: .infinity).frame(height: 32)
            }.buttonStyle(.plain).accessibilityLabel("Show \(WeekDate.longDay(day.date))")
            ForEach(day.events.filter(\.allDay)) { event in
                Button { onEvent(event) } label: {
                    Text(event.title).font(.caption2).lineLimit(1).padding(.horizontal, 4)
                        .frame(maxWidth: .infinity, alignment: .leading).frame(height: 22)
                        .background(Color(hex: event.calendarColor).opacity(0.17), in: RoundedRectangle(cornerRadius: 4))
                }.buttonStyle(.plain).accessibilityLabel("\(event.title), All day, \(event.calendarAlias)")
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 3).frame(width: width, height: headerHeight)
        .overlay(alignment: .leading) { Rectangle().fill(CWTheme.rule).frame(width: 0.5) }
    }

    private func dayColumn(_ day: DayPlan, width: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(0..<48) { halfHour in
                Rectangle().fill(CWTheme.rule.opacity(halfHour.isMultiple(of: 2) ? 1 : 0.45))
                    .frame(height: 0.5).offset(y: CGFloat(halfHour) * hourHeight / 2)
            }
            ForEach(CalendarTimelineLayout.blocks(events: day.events, date: day.date, timezone: timezone)) { block in
                eventBlock(block, date: day.date, width: width)
            }
            TimelineView(.periodic(from: .now, by: 60)) { context in
                if WeekDate.today(timeZoneIdentifier: timezone, now: context.date) == day.date {
                    Rectangle().fill(Color.red).frame(height: 1.5)
                        .overlay(alignment: .leading) { Circle().fill(Color.red).frame(width: 6, height: 6) }
                        .offset(y: CalendarTimelineLayout.minute(context.date, timezone: timezone) * hourHeight / 60)
                        .accessibilityLabel("Current time").allowsHitTesting(false)
                }
            }.allowsHitTesting(false)
        }
        .frame(width: width, height: hourHeight * 24, alignment: .topLeading)
        .clipped()
        .overlay(alignment: .leading) { Rectangle().fill(CWTheme.rule).frame(width: 0.5).allowsHitTesting(false) }
    }

    private func eventBlock(_ block: CalendarTimelineBlock, date: String, width: CGFloat) -> some View {
        let label = CalendarTimelineLayout.label(block.event, date: date, timezone: timezone)
        let eventWidth = width / CGFloat(block.columnCount)
        let eventHeight = max(18, (block.endMinute - block.startMinute) * hourHeight / 60) - 2
        return Button { onEvent(block.event) } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text(block.event.title).font(.system(size: 12, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                Text(label).font(.system(size: 10))
                Text(block.event.calendarAlias + (block.overlaps ? " · Overlap" : "")).font(.system(size: 10))
            }
            .foregroundStyle(CWTheme.ink).padding(.horizontal, 5).padding(.vertical, 3)
            .frame(width: max(1, eventWidth - 4), height: eventHeight, alignment: .topLeading)
            .background(Color(hex: block.event.calendarColor).opacity(0.17))
            .overlay(alignment: .leading) { Rectangle().fill(Color(hex: block.event.calendarColor)).frame(width: 3) }
            .clipShape(RoundedRectangle(cornerRadius: 4))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(block.event.title), \(label), \(block.event.calendarAlias)\(block.overlaps ? ", Overlaps another visible event" : "")")
        .accessibilityIdentifier("timeline-event-\(block.event.id)")
        .help("\(block.event.title) · \(label) · \(block.event.calendarAlias)")
        .offset(x: CGFloat(block.column) * eventWidth + 2, y: block.startMinute * hourHeight / 60)
    }

    private func hourLabel(_ hour: Int) -> String { "\(hour % 12 == 0 ? 12 : hour % 12) \(hour < 12 ? "AM" : "PM")" }
}
