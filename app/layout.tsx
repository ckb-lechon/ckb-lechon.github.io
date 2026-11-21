import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = "https://ckb-lechon.github.io";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "CKB Lechon | CK Bless Lechon House",
  description:
    "Celebrate with golden, freshly roasted lechon from CK Bless Lechon House. Browse the menu and schedule your pickup.",
  applicationName: "CKB Lechon",
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
