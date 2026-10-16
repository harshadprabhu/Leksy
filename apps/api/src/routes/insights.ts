import { tierOf, type Dataset } from "@leksy/insights";
import { stores } from "@leksy/core/db";
import { eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import type { Deps } from "../app.js";
import { brandOf, userAuth } from "../auth.js";

/**
 * Aggregates for the Insights page: two years of daily totals per store plus
 * 30-day staff, category and complaint breakdowns. No customer fields are read,
 * so nothing personal can reach the browser (or, if allowed, a copilot) from here.
 */
export const insightsRoutes = (d: Deps): FastifyPluginAsync => async (app) => {
  app.get("/v1/insights/dataset", { preHandler: userAuth() }, async (req): Promise<Dataset> => {
    const brandId = brandOf(req);
    const codes = req.principal?.storeCodes?.length ? req.principal.storeCodes : null;
    const scope = codes ? sql`and b.store_code in ${codes}` : sql``;
    // Breakdowns cover the last 30 calendar days in India, the same window as the daily rows.
    const detail = sql`(b.issued_at at time zone 'Asia/Kolkata')::date >= (now() at time zone 'Asia/Kolkata')::date - 29`;
    const [brand, storeRows, days, staff, categories, themes, asOf] = await Promise.all([
      d.db.query.brands.findFirst({ where: (b, { eq: e }) => e(b.id, brandId) }),
      d.db.query.stores.findMany({ where: eq(stores.brandId, brandId) }),
      d.db.execute(sql`
        select to_char(b.issued_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as date, b.store_code as store,
               sum(b.total)::float as revenue, count(*)::int as bills,
               coalesce(sum(f.rating), 0)::int as rating_sum, count(f.rating)::int as rating_count,
               count(*) filter (where f.nps >= 9)::int as promoters, count(*) filter (where f.nps <= 6)::int as detractors, count(f.nps)::int as nps_count,
               count(*) filter (where b.status in ('sent', 'delivered'))::int as sent, count(b.opened_at)::int as opened,
               count(*) filter (where f.rating <= 3)::int as low
        from bills b left join feedback f on f.bill_id = b.id
        where b.brand_id = ${brandId} and b.issued_at >= now() - interval '760 days' ${scope}
        group by 1, 2 order by 1, 2`),
      d.db.execute(sql`
        select b.data->'staff'->>'id' as id, coalesce(max(b.data->'staff'->>'name'), b.data->'staff'->>'id') as name, b.store_code as store,
               count(*)::int as bills, sum(b.total)::float as revenue, coalesce(sum(f.rating), 0)::int as rating_sum, count(f.rating)::int as rating_count
        from bills b left join feedback f on f.bill_id = b.id
        where b.brand_id = ${brandId} and ${detail} and b.data->'staff'->>'id' is not null ${scope}
        group by 1, 3`),
      // Each bill's total (tax included) is shared over its items by their pre-tax
      // amounts, so category revenue adds up exactly to store revenue.
      d.db.execute(sql`
        with items as (
          select b.id, b.store_code, b.total, coalesce(i->>'category', 'Other') as category,
                 (i->>'qty')::numeric as qty,
                 greatest((i->>'qty')::numeric * (i->>'unit_price')::numeric - coalesce((i->>'discount')::numeric, 0), 0) as amount,
                 count(*) over (partition by b.id) as n,
                 sum(greatest((i->>'qty')::numeric * (i->>'unit_price')::numeric - coalesce((i->>'discount')::numeric, 0), 0)) over (partition by b.id) as pre
          from bills b, jsonb_array_elements(b.data->'items') i
          where b.brand_id = ${brandId} and ${detail} ${scope}
        )
        select store_code as store, category,
               sum(case when pre > 0 then total * amount / pre else total / n end)::float as revenue,
               sum(qty)::float as units
        from items group by 1, 2`),
      // Complaint themes on the bill's store and date, like every other figure.
      d.db.execute(sql`
        select b.store_code as store, opt as option, count(*)::int as count
        from feedback f join bills b on b.id = f.bill_id, jsonb_array_elements_text(coalesce(f.answers->'improve', '[]'::jsonb)) opt
        where f.brand_id = ${brandId} and ${detail} ${scope}
        group by 1, 2`),
      d.db.execute(sql`select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as d`),
    ]);
    return {
      brand: brand?.name ?? "",
      asOf: String(asOf.rows[0]!.d),
      stores: storeRows
        .filter((s) => !codes || codes.includes(s.code))
        .map((s) => {
          const tier = tierOf(s.city);
          return { code: s.code, name: s.name, city: s.city ?? undefined, ...(s.region ? { region: s.region } : {}), ...(tier ? { tier } : {}) };
        }),
      days: days.rows.map((r) => ({
        date: String(r.date),
        store: String(r.store),
        revenue: Number(r.revenue),
        bills: Number(r.bills),
        ratingSum: Number(r.rating_sum),
        ratingCount: Number(r.rating_count),
        promoters: Number(r.promoters),
        detractors: Number(r.detractors),
        npsCount: Number(r.nps_count),
        sent: Number(r.sent),
        opened: Number(r.opened),
        low: Number(r.low),
      })),
      detailDays: 30,
      staff: staff.rows.map((r) => ({ id: String(r.id), name: String(r.name), store: String(r.store), bills: Number(r.bills), revenue: Number(r.revenue), ratingSum: Number(r.rating_sum), ratingCount: Number(r.rating_count) })),
      categories: categories.rows.map((r) => ({ store: String(r.store), category: String(r.category), revenue: Number(r.revenue), units: Number(r.units) })),
      themes: themes.rows.map((r) => ({ store: String(r.store), option: String(r.option), count: Number(r.count) })),
    };
  });
};
