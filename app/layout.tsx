import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = "https://ckb-lechon.github.io";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "CKB Lechon | CK Bless Lechon House",
  description:
    "Celebrate with golden, freshly roasted lechon from CK Bless Lechon House. Browse the menu and schedule your pickup.",
  applicationName: "CKB Lechon",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "CKB Lechon",
    statusBarStyle: "default",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: "CKB Lechon",
    title: "CKB Lechon | CK Bless Lechon House",
    description: "Golden, freshly roasted lechon for every celebration.",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "CKB Lechon by CK Bless Lechon House" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CKB Lechon | CK Bless Lechon House",
    description: "Golden, freshly roasted lechon for every celebration.",
    images: ["/opengraph-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#ff744a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
