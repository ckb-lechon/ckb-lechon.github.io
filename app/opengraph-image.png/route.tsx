import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "72px 86px",
          background: "#ff744a",
          color: "#381a13",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 28, fontWeight: 700 }}>
          <div style={{ width: 54, height: 54, borderRadius: 18, background: "#ff960d", display: "flex", alignItems: "center", justifyContent: "center" }}>C</div>
          CK BLESS LECHON HOUSE
        </div>
        <div style={{ fontSize: 120, fontWeight: 800, lineHeight: 1, marginTop: 38 }}>CKB Lechon</div>
        <div style={{ fontSize: 36, marginTop: 24 }}>Golden lechon. Good times, gathered.</div>
        <div style={{ position: "absolute", right: 104, bottom: 56, width: 220, height: 18, borderRadius: 99, background: "#ff3f00" }} />
        <div style={{ position: "absolute", right: 142, bottom: 90, width: 138, height: 12, borderRadius: 99, background: "#ffc2bc" }} />
      </div>
    ),
    { width: 1200, height: 630 },
  );
}