import type { Metadata } from "next";
import ORRA_PACK from "@/lib/orra-pack.json";
import { fontsHref, THEME_BOOT, themeVars } from "@/lib/theme";
import "./globals.css";

const DEMO = process.env.NEXT_PUBLIC_DEMO === "1";
// The demo is built for one client: its look is part of the page from the first paint.
const demoKit = DEMO ? ORRA_PACK.kit : null;

export const metadata: Metadata = {
  title: demoKit ? `${demoKit.name} · powered by Leksy` : "Leksy",
  description: demoKit ? `${demoKit.name}: digital bills, customer happiness and retail analytics` : "Luxury digital bills, Project WOW and retail analytics",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const vars = demoKit ? themeVars(demoKit) : null;
  const brandFonts = demoKit ? fontsHref([demoKit.headingFont, demoKit.bodyFont]) : null;
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
        {brandFonts && <link href={brandFonts} rel="stylesheet" />}
        {vars && <style>{`html:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(";")}}`}</style>}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
