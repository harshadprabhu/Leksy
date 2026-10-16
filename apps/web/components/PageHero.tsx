"use client";
import { FACE_COLORS, FACE_LABELS, faceSvg } from "@leksy/survey";
import { useBrand } from "@/components/Shell";

export interface HeroStat {
  value: string;
  label: string;
}

/**
 * Page header in the brand's look: a band in the brand colour with the light
 * logo, a serif title and headline figures. Falls back to the Leksy look.
 */
export function PageHero({ kicker, title, sub, stats = [], children }: { kicker: string; title: string; sub?: React.ReactNode; stats?: HeroStat[]; children?: React.ReactNode }) {
  const kit = useBrand();
  const logo = kit?.logoLight ?? kit?.logo;
  const mark = kit?.watermark ? (kit.logoLight ?? kit.mark ?? kit.logo) : undefined;
  return (
    <section className="ins-hero">
      {mark && <div className="ins-hero-wm" style={{ backgroundImage: `url(${mark})` }} aria-hidden="true" />}
      <div className="ins-hero-main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {logo && <img className="ins-hero-logo" src={logo} alt={kit!.name} />}
        <div>
          <div className="ins-kicker">
            {kicker}
            {kit ? ` · ${kit.name}` : ""}
          </div>
          <h1>{title}</h1>
          {sub && <div className="ins-sub">{sub}</div>}
        </div>
      </div>
      {stats.length > 0 && (
        <div className="ins-stats">
          {stats.map((s) => (
            <div key={s.label}>
              <b>{s.value}</b>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}
      {children && <div className="ins-hero-foot">{children}</div>}
    </section>
  );
}

/** A 1–5 rating as the same face customers tap on their bill. */
export function Face({ rating, size = 22 }: { rating: number; size?: number }) {
  return <span className="face" title={`${rating} of 5`} dangerouslySetInnerHTML={{ __html: faceSvg(rating, size) }} />;
}

export { FACE_COLORS, FACE_LABELS };
