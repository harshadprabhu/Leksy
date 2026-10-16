"use client";
/**
 * Turns a bill's printable HTML into a real PDF file in the browser (demo build;
 * the API renders PDFs on the server). The page is laid out off-screen at A4 width,
 * drawn at twice the resolution, and split across A4 pages when it is taller.
 */
const A4_PX = 794; // A4 width at 96 dpi

export async function htmlToPdf(html: string): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_PX}px;height:1123px;border:0;visibility:hidden`;
  document.body.appendChild(frame);
  try {
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = html;
    });
    const doc = frame.contentDocument!;
    // Fonts and images (logo, watermark) must be ready before drawing.
    await doc.fonts?.ready;
    await Promise.all([...doc.images].map((img) => (img.complete ? null : new Promise((r) => ((img.onload = r), (img.onerror = r))))));
    frame.style.height = `${doc.documentElement.scrollHeight}px`;
    const canvas = await html2canvas(doc.body, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: A4_PX, width: A4_PX });
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
    const pageW = 210;
    const pageH = 297;
    const imgH = (canvas.height * pageW) / canvas.width;
    const img = canvas.toDataURL("image/jpeg", 0.92);
    for (let y = 0, page = 0; y < imgH - 0.5; y += pageH, page++) {
      if (page) pdf.addPage();
      pdf.addImage(img, "JPEG", 0, -y, pageW, imgH);
    }
    return pdf.output("blob");
  } finally {
    frame.remove();
  }
}

/** Save a blob as a file in the device's downloads. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Share the PDF itself through the phone's share sheet (WhatsApp, Mail…) where the
 * browser can share files; otherwise share the link; otherwise download it.
 */
export async function sharePdf(blob: Blob, name: string, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const file = new File([blob], name, { type: "application/pdf" });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title });
      return "shared";
    }
    if (navigator.share) {
      await navigator.share({ title, url: location.href });
      return "shared";
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return "cancelled";
  }
  saveBlob(blob, name);
  return "downloaded";
}
