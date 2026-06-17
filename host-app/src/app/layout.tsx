import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quiz4Win Host",
  description: "Quiz4Win Host dashboard — manage your live shows, invitations, and earnings.",
  applicationName: "Quiz4Win Host",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#09070E",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">{children}</body>
    </html>
  );
}
