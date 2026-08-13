import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Week of Us accesses, uses, stores, and protects Google Calendar and account data.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="Privacy Policy"
      updated="August 13, 2026"
      introduction="Week of Us is a shared family planner. This policy explains what information the service handles, including information received through Google APIs, and the choices available to you."
      sections={[
        {
          title: "Information we collect",
          items: [
            "Google account information: your Google account identifier, verified email address, display name, and profile image when you sign in.",
            "Google Calendar information: the calendars you can access and events from calendars you explicitly choose to share with your Week of Us household.",
            "Planner information: household membership, invitations, plans, notes, tasks, calendar display preferences, saved locations, and app preferences.",
            "Service data: encrypted Google OAuth credentials, expiring session records, short-lived provider caches, and technical records needed to operate and secure the service.",
          ],
        },
        {
          title: "How Google user data is used",
          paragraphs: [
            "Week of Us uses Google account data to authenticate you and associate your choices with your account. It uses Google Calendar data only to provide the user-facing calendar features you request: listing your calendars, showing events from calendars you select, and, after a separate opt-in, creating, updating, or deleting single events on calendars where Google grants you write access.",
            "Calendar access is private by default. A newly discovered calendar is not shown to another household member unless you explicitly select it. Calendar editing is also off by default and is requested through incremental authorization only when you choose to enable it.",
          ],
        },
        {
          title: "Google API Services User Data Policy",
          paragraphs: [
            "Week of Us’s use and transfer to any other app of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.",
            "Google user data is not used for advertising, sold, used to determine creditworthiness, or used to train generalized artificial intelligence or machine-learning models. Humans do not read Google user data except with your affirmative agreement for support or security purposes, when required by law, or when the data has been aggregated and anonymized for internal service operations.",
          ],
        },
        {
          title: "Storage, security, and retention",
          paragraphs: [
            "Week of Us stores account and planner data in its private PostgreSQL database. Google access and refresh tokens are encrypted before storage. Access is limited by the signed-in user and household, and the browser never receives database credentials or another member’s Google credentials.",
            "Calendar event responses are cached for approximately five minutes to keep the planner responsive. Authentication sessions expire after 30 days. Account, planner, calendar preference, and encrypted connection records are kept while your account remains active or as needed to operate the service, resolve security issues, and meet legal obligations.",
          ],
        },
        {
          title: "Sharing and service providers",
          paragraphs: [
            "Calendar names and events from calendars you select are shared only with members of your Week of Us household so the shared planner can function. We do not sell personal data. We disclose data only to infrastructure providers acting on our behalf, when you direct us to, to protect the service and its users, or when legally required.",
            "Week of Us sends saved coordinates to Open-Meteo to retrieve weather forecasts and sends location search text to Open-Meteo’s geocoding service. Google Calendar data is not sent to Open-Meteo.",
          ],
        },
        {
          title: "Your choices and deletion",
          paragraphs: [
            "You can keep individual calendars private, stop sharing a previously selected calendar, and avoid enabling Calendar editing. You can also revoke Week of Us access at any time from your Google Account’s third-party connections page.",
            "You can request deletion of your Week of Us account and associated personal data from Settings after signing in, or by emailing jgreco@gmail.com from the Google email address used for the account. We may need to verify emailed requests. Deletion from active systems will be completed within 30 days unless retention is required for security or legal reasons.",
          ],
        },
        {
          title: "Contact and changes",
          paragraphs: [
            "Questions, privacy requests, and complaints can be sent to jgreco@gmail.com. If this policy changes materially, the effective date above will be updated and notice will be provided in the service when appropriate.",
          ],
        },
      ]}
    />
  );
}
