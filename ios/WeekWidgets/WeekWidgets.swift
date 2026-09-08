import SwiftUI
import WidgetKit
struct WeekEntry: TimelineEntry { let date: Date; let snapshot: WidgetSnapshot? }
struct WeekProvider: TimelineProvider {
    func placeholder(in context: Context) -> WeekEntry { WeekEntry(date: .now, snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (WeekEntry) -> Void) { completion(WeekEntry(date: .now, snapshot: WidgetSnapshot.read())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<WeekEntry>) -> Void) {
        let now = Date(); let snapshot = WidgetSnapshot.read()
        let dates = [now] + (snapshot?.next.map(\.date).filter { $0 > now && $0 < now.addingTimeInterval(3600) } ?? [])
        completion(Timeline(entries: dates.map { WeekEntry(date: $0, snapshot: snapshot) }, policy: .after(now.addingTimeInterval(1800))))
    }
}
struct WeekWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: WeekEntry
    var next: WidgetSnapshot.Commitment? { entry.snapshot?.next.first { $0.date > entry.date } }
    var body: some View {
        Group {
            if family == .accessoryCircular { VStack { Image(systemName: "checklist"); Text("\(entry.snapshot?.tasks.count ?? 0)") } }
            else if family == .accessoryInline { Text(next.map { "Next: \($0.title)" } ?? "Open your family week") }
            else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Week of Us").font(.caption).foregroundStyle(.secondary)
                    if let next { Text(next.title).font(.headline).lineLimit(2); Text(next.date, style: .time).font(.caption) }
                    else { Text(entry.snapshot == nil ? "Open the app to update" : "No upcoming shared events").font(.headline) }
                    if family == .systemMedium || family == .systemSmall {
                        if let task = entry.snapshot?.tasks.first { Text("☐ \(task)").font(.caption).lineLimit(2) }
                        if let updated = entry.snapshot?.updated { Text("Updated \(updated, style: .relative) ago").font(.caption2).foregroundStyle(.secondary) }
                        if family == .systemMedium { HStack { Link("My tasks", destination: URL(string: "commonweek://planner?tasks=1")!); Spacer(); Link("Add task", destination: URL(string: "commonweek://planner?capture=1")!) }.font(.caption) }
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }.privacySensitive().containerBackground(.fill.tertiary, for: .widget).widgetURL(URL(string: "commonweek://planner?tasks=1"))
    }
}
@main
struct FamilyWeekWidget: Widget {
    let kind = "FamilyWeek"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: WeekProvider()) { WeekWidgetView(entry: $0) }
            .configurationDisplayName("Family week")
            .description("Your next shared commitment and open tasks. Open Week of Us to refresh.")
            .supportedFamilies([.systemSmall, .systemMedium, .accessoryInline, .accessoryRectangular, .accessoryCircular])
    }
}
