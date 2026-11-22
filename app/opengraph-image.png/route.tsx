import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export async function GET() {
  const foodPhoto = await readFile(join(process.cwd(), "public", "display.webp"));
  const foodPhotoSrc = `data:image/webp;base64,${foodPhoto.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#fff8f0",
          color: "#352019",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: -115,
            left: 472,
            width: 300,
            height: 300,
            borderRadius: 999,
            background: "#ffe5d7",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 0,
            width: 505,
            height: "100%",
            display: "flex",
            overflow: "hidden",
            background: "#5a2b1b",
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundImage: `url(${foodPhotoSrc})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(180deg, rgba(35, 17, 11, 0.04) 38%, rgba(35, 17, 11, 0.78) 100%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 38,
              right: 34,
              bottom: 40,
              display: "flex",
              flexDirection: "column",
              color: "#fff8f0",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2.2, color: "#ffd6ae" }}>
              SLOW ROASTED · MADE TO SHARE
            </div>
            <div style={{ marginTop: 8, fontSize: 30, fontWeight: 700 }}>Golden from every angle.</div>
          </div>
        </div>

        <div
          style={{
            width: 695,
            height: "100%",
            padding: "57px 45px 45px 72px",
            display: "flex",
            flexDirection: "column",
            position: "relative",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                width: 48,
                height: 48,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 15,
                color: "#fffaf6",
                background: "#f26a43",
                fontSize: 24,
                fontWeight: 800,
              }}
            >
              C
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1.5 }}>CK BLESS LECHON HOUSE</div>
              <div style={{ fontSize: 13, color: "#987365", letterSpacing: 1.2 }}>BUTUAN CITY · PHILIPPINES</div>
            </div>
          </div>

          <div
            style={{
              width: 226,
              marginTop: 64,
              padding: "9px 14px",
              display: "flex",
              alignItems: "center",
              border: "1px solid #f3c2a9",
              borderRadius: 999,
              color: "#a84b2e",
              background: "#fff1e5",
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: 1.5,
            }}
          >
            THE TABLE IS WAITING
          </div>

          <div
            style={{
              marginTop: 27,
              display: "flex",
              flexDirection: "column",
              fontSize: 61,
              lineHeight: 1.04,
              fontWeight: 800,
              letterSpacing: -2.6,
            }}
          >
            <span>Big days deserve</span>
            <span style={{ color: "#eb4a19" }}>golden lechon.</span>
          </div>

          <div
            style={{
              maxWidth: 490,
              marginTop: 20,
              color: "#795b4f",
              fontSize: 20,
              lineHeight: 1.45,
            }}
          >
            Freshly roasted for the people and moments that bring us together.
          </div>

          <div
            style={{
              marginTop: "auto",
              display: "flex",
              alignItems: "center",
              gap: 12,
              color: "#6b3927",
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            <div style={{ width: 35, height: 3, borderRadius: 2, background: "#f04b20" }} />
            CELEBRATE WITH CKB LECHON
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
