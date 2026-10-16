/**
 * Brand theme as CSS variables. Shared by the page skeleton (so the first paint
 * is already in the brand's look) and the app (when the brand changes).
 */
export interface ThemeKit {
  name: string;
  primary: string;
  accent: string;
  ui?: string;
  headingFont: string;
  bodyFont: string;
}

export const GOOGLE_FONTS = ["Cormorant Garamond", "Playfair Display", "Cinzel", "Marcellus", "Red Hat Display", "Nunito", "Inter", "Montserrat", "Lato", "Figtree"];

export function themeVars(kit: ThemeKit): Record<string, string> {
  const c = kit.ui ?? kit.accent;
  return {
    "--accent": c,
    "--accent-soft": `color-mix(in srgb, ${c} 12%, transparent)`,
    "--brand-ink": kit.primary,
    "--brand": kit.ui ?? kit.primary,
    "--brand-gold": kit.accent,
    "--brand-head": `"${kit.headingFont}", Georgia, serif`,
    "--app-font": `"${kit.bodyFont}", Inter, system-ui, sans-serif`,
  };
}

export function fontsHref(fonts: string[]): string | null {
  const want = [...new Set(fonts)].filter((f) => GOOGLE_FONTS.includes(f));
  return want.length ? `https://fonts.googleapis.com/css2?${want.map((f) => `family=${encodeURIComponent(f)}:wght@400;500;600;700`).join("&")}&display=swap` : null;
}

/** Where the app remembers the last brand theme, so a reload paints it at once. */
export const THEME_KEY = "lx_theme";

/**
 * Runs in <head> before anything paints: applies the remembered theme (if any)
 * over the built-in one.
 */
export const THEME_BOOT = `try{var t=JSON.parse(localStorage.getItem("${THEME_KEY}")||"null");if(t&&t.vars){var s=document.documentElement.style;for(var k in t.vars)s.setProperty(k,t.vars[k]);if(t.fonts){var l=document.createElement("link");l.rel="stylesheet";l.href=t.fonts;document.head.appendChild(l);}}}catch(e){}`;
