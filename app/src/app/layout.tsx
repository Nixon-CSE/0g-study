import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/layout/Providers";
import { Manrope } from "next/font/google";

const manrope = Manrope({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-manrope" });

// Public URL of the deployed app (used for absolute Open Graph links). Set NEXT_PUBLIC_SITE_URL in production.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const siteTitle = "0G Study — study your notes with a team of AI agents";
const siteDescription =
  "Photograph your notes and a pod of AI agents explains them, writes flashcards and quizzes you. Powered by 0G Private Computer, with a request ID on every reply.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: siteTitle,
  description: siteDescription,
  applicationName: "0G Study",
  keywords: [
    "study app",
    "AI tutor",
    "flashcards",
    "study streak",
    "0G Private Computer",
    "AI agents",
    "ERC-7857",
    "INFT",
  ],
  manifest: "/site.webmanifest",
  appleWebApp: { capable: true, title: "0G Study", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    title: siteTitle,
    description: siteDescription,
    siteName: "0G Study",
    images: [
      {
        url: "/site-banner.png",
        width: 1200,
        height: 630,
        alt: "0G Study — study your notes with a team of AI agents",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/site-banner.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#e9e9e6",
  width: "device-width",
  initialScale: 1,
  // Lets the page use the area around the notch; insets are handled with env(safe-area-inset-*).
  viewportFit: "cover",
  // Android: the keyboard resizes the page, so the composer stays above it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`h-full ${manrope.variable}`}>
      <head>
        {/* Geist Mono is not in next/font for this Next version; data font only (addresses, hashes). */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400&display=swap" />
      </head>
      <body className="h-full overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
