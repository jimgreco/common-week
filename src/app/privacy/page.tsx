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
      updated="August 21, 2026"
      introduction="Week of Us is a shared family planner. This policy explains what information the service handles, including information received through Google APIs, and the choices available to you."
      sections={[
        {
          title: "Information we collect",
          items: [
            "Account information: your Apple or Google account identifier, verified email address, display name, and profile image when the provider supplies one.",
            "Google Calendar information: the calendars you can access and events from calendars you explicitly choose to share with your Week of Us household.",
            "Planner information: household membership, invitations, plans, notes, tasks, calendar display preferences, saved locations, and app preferences.",
            "Service data: encrypted Apple and Google OAuth credentials, expiring session and invitation records, short-lived provider caches, protected offline iPhone data, and technical records needed to operate and secure the service.",
          ],
        },
        {
          title: "How Google user data is used",
          paragraphs: [
            "Week of Us uses Google account data to authenticate you and associate your choices with your account. It uses Google Calendar data only to provide the user-facing calendar features you request: listing your calendars, showing events according to the visibility you choose, and, after a separate opt-in, creating, updating, or deleting events on calendars where Google grants your connected account write access. If you choose Share, household owners and members may make those event changes through Week of Us. Changes to recurring events apply only to the selected occurrence.",
            "Calendar access is hidden by default. You can keep a calendar out of Week of Us, show it privately only to yourself, or explicitly share it with your household. Calendar editing is also off by default and is requested through incremental authorization only when you choose to enable it. Private and hidden calendars are never editable by another household member.",
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
            "Week of Us stores account and planner data in its private PostgreSQL database. Apple and Google tokens are encrypted before storage. Access is limited by the signed-in user and household, and clients never receive database credentials or another member’s provider credentials.",
            "Calendar event responses are cached for approximately five minutes to keep the planner responsive. Authentication sessions expire after 30 days. Account, planner, calendar preference, and encrypted connection records are kept while your account remains active or as needed to operate the service, resolve security issues, and meet legal obligations.",
          ],
        },
        {
          title: "Sharing and service providers",
          paragraphs: [
            "Calendar names and events are shared with members of your Week of Us household only when you choose Share for that calendar. When you also enable Calendar editing and Google grants write access, household owners and members can add, edit, and delete events on that Shared calendar through Week of Us. Private calendars remain visible only to their owner, hidden calendars do not appear in the app, and viewer household roles cannot edit events. We do not sell personal data. We disclose data only to infrastructure providers acting on our behalf, when you direct us to, to protect the service and its users, or when legally required.",
            "Week of Us sends invitation recipient addresses to Resend to deliver invitations, saved coordinates to Open-Meteo to retrieve weather forecasts, and location search text to Open-Meteo’s geocoding service. Google Calendar data is not sent to Resend or Open-Meteo.",
          ],
        },
        {
          title: "Your choices and deletion",
          paragraphs: [
            "You can hide individual calendars, keep them private to your account, stop sharing a calendar to remove household editing access, and avoid enabling Calendar editing. You can also revoke Week of Us access at any time from your Google Account’s third-party connections page.",
            "You can permanently delete your Week of Us account and associated personal data directly from Settings on the web or iPhone. Connected Apple and Google authorizations are revoked when credentials are available. A household owner must transfer ownership first if other members remain; a sole-member household is deleted with the account.",
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
