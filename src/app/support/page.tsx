import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Support",
  description: "Help and contact information for Week of Us.",
};

export default function SupportPage() {
  return (
    <LegalPage
      eyebrow="Support"
      title="Week of Us Support"
      updated="August 23, 2026"
      introduction="Get help with your account, household, planner, or connected Google Calendar."
      sections={[
        {
          title: "Contact",
          paragraphs: [
            "Email jgreco@gmail.com with a description of the issue. Include the device and iOS version you are using, but do not send passwords, authorization codes, or calendar contents.",
          ],
        },
        {
          title: "Account and privacy",
          paragraphs: [
            "You can permanently delete your account from Settings in the iPhone app or website. Household owners with other members must transfer ownership first; this can be completed directly from Household settings.",
            "For privacy questions, data requests, or concerns about a connected provider, review the Privacy Policy or contact support.",
          ],
        },
        {
          title: "Google Calendar",
          paragraphs: [
            "Google Calendar is optional. Connect it from Settings, refresh the calendar list, then choose Hide, Private, or Share for each calendar. Calendar editing remains off until you enable it separately.",
          ],
        },
      ]}
    />
  );
}
