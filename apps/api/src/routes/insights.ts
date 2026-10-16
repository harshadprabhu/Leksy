import type { Dataset } from "@leksy/insights";
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
    const scope = req.principal?.storeCodes?.length ? sql`and b.store_code = any(${req.principal.storeCodes})` : sql``;
    const [brand, storeRows, days, staff, categories, themes, asOf] = await Promise.all([
      d.db.query.brands.findFirst({ where: (b, { eq: e }) => e(b.id, brandId) }),
      d.db.query.stores.findMany({ where: eq(stores.brandId, brandId) }),
      d.db.execute(sql`
        select to_char(b.issued_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as date, b.store_code as store,
               sum(b.total)::float as revenue, count(*)::int as bills,
               coalesce(sum(f.rating), 0)::int as rating_sum, count(f.rating)::int as rating_count,
               count(*) filter (where f.nps >= 9)::int as promoters, count(*) filter (where f.nps <= 6)::int as detractors, count(f.nps)::int as nps_count
        from bills b left join feedback f on f.bill_id = b.id
        where b.brand_id = ${brandId} and b.issued_at >= now() - interval '760 days' ${scope}
        group by 1, 2 order by 1`),
      d.db.execute(sql`
        select b.data->'staff'->>'id' as id, coalesce(max(b.data->'staff'->>'name'), b.data->'staff'->>'id') as name, b.store_code as store,
               count(*)::int as bills, sum(b.total)::float as revenue, coalesce(sum(f.rating), 0)::int as rating_sum, count(f.rating)::int as rating_count
        from bills b left join feedback f on f.bill_id = b.id
        where b.brand_id = ${brandId} and b.issued_at >= now() - interval '30 days' and b.data->'staff'->>'id' is not null ${scope}
        group by 1, 3`),
      d.db.execute(sql`
        select coalesce(i->>'category', 'Other') as category,
               sum((i->>'qty')::numeric * (i->>'unit_price')::numeric - coalesce((i->>'discount')::numeric, 0))::float as revenue,
               sum((i->>'qty')::numeric)::float as units
        from bills b, jsonb_array_elements(b.data->'items') i
        where b.brand_id = ${brandId} and b.issued_at >= now() - interval '30 days' ${scope}
        group by 1`),
      d.db.execute(sql`
        select opt as option, count(*)::int as count
        from feedback f, jsonb_array_elements_text(coalesce(f.answers->'improve', '[]'::jsonb)) opt
        where f.brand_id = ${brandId} and f.created_at >= now() - interval '30 days'
        group by 1 order by 2 desc limit 10`),
      d.db.execute(sql`select to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') as d`),
    ]);
    return {
      brand: brand?.name ?? "",
      asOf: String(asOf.rows[0]!.d),
      stores: storeRows.map((s) => ({ code: s.code, name: s.name, city: s.city ?? undefined })),
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
      })),
      detailDays: 30,
      staff: staff.rows.map((r) => ({ id: String(r.id), name: String(r.name), store: String(r.store), bills: Number(r.bills), revenue: Number(r.revenue), ratingSum: Number(r.rating_sum), ratingCount: Number(r.rating_count) })),
      categories: categories.rows.map((r) => ({ category: String(r.category), revenue: Number(r.revenue), units: Number(r.units) })),
      themes: themes.rows.map((r) => ({ option: String(r.option), count: Number(r.count) })),
    };
  });
};
