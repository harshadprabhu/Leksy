import { BASE_PATH } from "@/lib/demo";

/** Leksy's logo: icon and wordmark. `light` is the version for dark backgrounds. */
export function LeksyLogo({ height = 28, light = false, className }: { height?: number; light?: boolean; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`${BASE_PATH}/leksy/${light ? "leksy-logo-light" : "leksy-logo"}.png`} alt="Leksy" height={height} style={{ height, width: "auto" }} className={`leksy-logo ${className ?? ""}`} />
  );
}

/** "Powered by [Leksy logo]", for places that show a client's brand. */
export function PoweredByLeksy({ light = false, height = 14 }: { light?: boolean; height?: number }) {
  return (
    <span className="powered-by">
      powered by <LeksyLogo height={height} light={light} />
    </span>
  );
}
