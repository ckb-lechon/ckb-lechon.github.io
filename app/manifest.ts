import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CKB Lechon | CK Bless Lechon House",
    short_name: "CKB Lechon",
    description: "Golden, freshly roasted lechon for every celebration.",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf6",
    theme_color: "#ff744a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
