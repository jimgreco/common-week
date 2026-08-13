import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--font-display", subsets: ["latin"], axes: ["opsz"] });
const description = "A shared weekly family planner for calendars, locations, weather, notes, and tasks.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://weekofus.com"),
  applicationName: "Week of Us",
  title: { default: "Week of Us", template: "%s · Week of Us" },
  description,
  appleWebApp: { title: "Week of Us" },
  icons: { icon: "/icon.svg" },
  openGraph: { type: "website", title: "Week of Us", siteName: "Week of Us", description },
  twitter: { card: "summary", title: "Week of Us", description },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${newsreader.variable} h-full antialiased`}>
      <body>{children}</body>
    </html>
  );
}
