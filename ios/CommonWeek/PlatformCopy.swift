import Foundation

enum PlatformCopy {
    static let offlinePlannerUnavailable = "You’re offline and this week has not been saved on this device yet."
    static let appleReminderDeviceOnly = "This task is saved in Apple Reminders and appears only on this device."
    static let remindersAccessDenied = "Allow Reminders access in System Settings to use this feature."

    static var sharedMessages: [String] {
        [offlinePlannerUnavailable, appleReminderDeviceOnly, remindersAccessDenied]
    }
}
