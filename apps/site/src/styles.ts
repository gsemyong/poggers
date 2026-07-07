import { defineStyles } from "@poggers/kit/style";
import type { App } from "./types";

export default defineStyles<App>({
  defaultPreset: "system",
  presets: {
    system: {
      SiteShell: {
        Root: {
          minHeight: "100dvh",
          display: "grid",
          gridTemplateColumns: "minmax(180px, 240px) minmax(0, 1fr)",
          fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
          color: "#20242a",
          background: "linear-gradient(135deg, #f7f3ea 0%, #f4f7fb 42%, #eef7f1 100%)",
        },
        Sidebar: {
          borderRight: "1px solid rgba(32, 36, 42, 0.14)",
          padding: "28px 20px",
          background: "rgba(255, 255, 255, 0.46)",
        },
        Brand: {
          fontWeight: 760,
          fontSize: 17,
          marginBottom: 28,
        },
        Nav: {
          display: "grid",
          gap: 6,
        },
        Content: {
          minWidth: 0,
        },
      },
      NavButton: {
        Root: {
          width: "100%",
          border: 0,
          borderRadius: 6,
          background: "rgba(255, 255, 255, 0.58)",
          color: "#48515d",
          cursor: "pointer",
          padding: "9px 10px",
          textAlign: "left",
          font: "inherit",
        },
        Label: {
          display: "inline-flex",
        },
      },
      PageHero: {
        Root: {
          maxWidth: 920,
          padding: "70px 48px 48px",
        },
        Mark: {
          width: 68,
          aspectRatio: "1",
          display: "grid",
          placeItems: "center",
          borderRadius: 8,
          background: "#20242a",
          color: "#fffaf0",
          fontWeight: 800,
          marginBottom: 28,
        },
        Eyebrow: {
          margin: "0 0 10px",
          color: "#596473",
          fontSize: 13,
          fontWeight: 700,
          textTransform: "uppercase",
        },
        Title: {
          margin: 0,
          fontSize: 56,
          lineHeight: 1,
        },
        Summary: {
          maxWidth: 640,
          margin: "20px 0 0",
          color: "#48515d",
          fontSize: 20,
          lineHeight: 1.5,
        },
        Sections: {
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 14,
          marginTop: 42,
        },
      },
      SectionCard: {
        Root: {
          border: "1px solid rgba(32, 36, 42, 0.13)",
          borderRadius: 8,
          background: "rgba(255, 255, 255, 0.58)",
          padding: 18,
        },
        Title: {
          margin: "0 0 10px",
          fontSize: 17,
        },
        Body: {
          margin: 0,
          color: "#515b68",
          lineHeight: 1.5,
        },
      },
    },
    dense: {
      SiteShell: {
        Root: {
          gridTemplateColumns: "1fr",
        },
        Sidebar: {
          borderRight: 0,
          borderBottom: "1px solid rgba(32, 36, 42, 0.14)",
          padding: "18px 16px",
        },
        Nav: {
          gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        },
      },
      PageHero: {
        Root: {
          padding: "42px 22px",
        },
        Title: {
          fontSize: 42,
        },
      },
    },
  },
});
