import type { Browser } from "playwright-core";

export interface PdfRenderer {
  render(html: string, format: "mobile" | "a4" | "thermal"): Promise<Buffer>;
  close(): Promise<void>;
}

/**
 * HTML → PDF with headless Chromium, so the PDF matches the web bill exactly.
 * One browser per process, one page per render.
 */
export function chromiumPdf(executablePath?: string): PdfRenderer {
  let browser: Promise<Browser> | null = null;
  const get = async () => {
    browser ??= import("playwright-core").then(({ chromium }) => chromium.launch({ executablePath, args: ["--no-sandbox", "--font-render-hinting=none"] }));
    return browser;
  };
  return {
    async render(html, format) {
      const b = await get();
      const page = await b.newPage();
      try {
        await page.setContent(html, { waitUntil: "networkidle", timeout: 20_000 });
        const width = format === "a4" ? "210mm" : format === "thermal" ? "80mm" : "120mm";
        const opts = format === "a4" ? { format: "A4" as const } : { width, height: `${Math.ceil(await page.evaluate(() => document.body.scrollHeight)) + 2}px` };
        return Buffer.from(await page.pdf({ ...opts, printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } }));
      } finally {
        await page.close();
      }
    },
    async close() {
      if (browser) await (await browser).close();
    },
  };
}
