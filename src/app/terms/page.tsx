import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms governing use of Week of Us.",
};

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Terms"
      title="Terms of Service"
      updated="August 13, 2026"
      introduction="These terms govern your use of Week of Us. By using the service, you agree to these terms. If you do not agree, do not use the service."
      sections={[
        {
          title: "The service",
          paragraphs: [
            "Week of Us provides a shared weekly planner for household calendars, locations, weather, notes, and tasks. Features may change as the service improves. Google Calendar editing is optional and applies only to single events on calendars where your Google account has write permission.",
          ],
        },
        {
          title: "Your account and household",
          paragraphs: [
            "You are responsible for your Google account, the accuracy of information you provide, and activity performed through your Week of Us session. Invite only people you intend to join your household. Household members can see data that you explicitly share into the common planner.",
          ],
        },
        {
          title: "Acceptable use",
          items: [
            "Do not use the service unlawfully, to harm others, or to violate another person’s privacy or intellectual-property rights.",
            "Do not attempt to bypass access controls, interfere with the service, probe another household’s data, or misuse Google APIs.",
            "Do not use automated means that impose an unreasonable load on the service or its providers.",
          ],
        },
        {
          title: "Your content and connected services",
          paragraphs: [
            "You retain ownership of content you add. You grant Week of Us the limited permission needed to store, process, and display that content to you and your household. Your use of Google and other third-party services remains subject to their own terms and policies.",
          ],
        },
        {
          title: "Availability and disclaimers",
          paragraphs: [
            "The service is provided on an as-is and as-available basis. Weather, calendar, and location information can be delayed, incomplete, or unavailable, and should not be relied on for emergencies or safety-critical decisions. To the fullest extent permitted by law, no warranties are made regarding uninterrupted availability, accuracy, or fitness for a particular purpose.",
          ],
        },
        {
          title: "Limitation of liability",
          paragraphs: [
            "To the fullest extent permitted by law, Week of Us and its operator will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost data, profits, or opportunities arising from use of the service. Some jurisdictions do not allow certain limitations, so portions of this section may not apply to you.",
          ],
        },
        {
          title: "Suspension, termination, and changes",
          paragraphs: [
            "Access may be suspended or ended when necessary to protect users, the service, or third parties, or when these terms are materially violated. You may stop using the service at any time and request account deletion as described in the Privacy Policy. Material changes to these terms will be reflected by updating the effective date and, when appropriate, by providing notice in the service.",
          ],
        },
        {
          title: "Contact",
          paragraphs: [
            "Questions about these terms can be sent to jgreco@gmail.com.",
          ],
        },
      ]}
    />
  );
}
