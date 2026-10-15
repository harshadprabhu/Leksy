import { sql } from "drizzle-orm";
import type { Db } from "../db/index.js";

export interface Summary {
  bills: number;
  sent: number;
  opened: number;
  responses: number;
  avgRating: number | null;
  nps: number | null;
  openTickets: number;
  revenue: number;
  byStore: { store: string; bills: number; opened: number; responses: number; avgRating: number | null; nps: number | null }[];
  byDay: { day: string; bills: number; opened: number; responses: number; avgRating: number | null }[];
  themes: { option: string; count: number }[];
}

const num = (v: unknown) => (v == null ? null : Number(v));

/**
 * Dashboard aggregates straight from PostgreSQL. At scale these queries move to
 * ClickHouse fed from the events table; the response shape stays the same.
 */
export async function summary(db: Db, brandId: string, from: Date, to: Date, storeCodes?: string[]): Promise<Summary> {
  const storeFilter = storeCodes?.length ? sql`and b.store_code = any(${storeCodes})` : sql``;
  const totals = await db.execute(sql`
    select count(*)::int as bills,
           count(*) filter (where b.status in ('sent','delivered'))::int as sent,
           count(b.opened_at)::int as opened,
           count(f.id)::int as responses,
           round(avg(f.rating)::numeric, 2) as avg_rating,
           round(100.0 * (count(*) filter (where f.nps >= 9) - count(*) filter (where f.nps <= 6)) / nullif(count(f.nps), 0), 1) as nps,
           count(*) filter (where f.ticket_status in ('open','in_progress'))::int as open_tickets,
           coalesce(sum(b.total), 0) as revenue
    from bills b left join feedback f on f.bill_id = b.id
    where b.brand_id = ${brandId} and b.issued_at >= ${from} and b.issued_at < ${to} ${storeFilter}`);
  const byStore = await db.execute(sql`
    select b.store_code as store, count(*)::int as bills, count(b.opened_at)::int as opened, count(f.id)::int as responses,
           round(avg(f.rating)::numeric, 2) as avg_rating,
           round(100.0 * (count(*) filter (where f.nps >= 9) - count(*) filter (where f.nps <= 6)) / nullif(count(f.nps), 0), 1) as nps
    from bills b left join feedback f on f.bill_id = b.id
    where b.brand_id = ${brandId} and b.issued_at >= ${from} and b.issued_at < ${to} ${storeFilter}
    group by b.store_code order by avg(f.rating) asc nulls last, count(*) desc limit 200`);
  const byDay = await db.execute(sql`
    select to_char(date_trunc('day', b.issued_at at time zone 'Asia/Kolkata'), 'YYYY-MM-DD') as day,
           count(*)::int as bills, count(b.opened_at)::int as opened, count(f.id)::int as responses, round(avg(f.rating)::numeric, 2) as avg_rating
    from bills b left join feedback f on f.bill_id = b.id
    where b.brand_id = ${brandId} and b.issued_at >= ${from} and b.issued_at < ${to} ${storeFilter}
    group by 1 order by 1`);
  const themes = await db.execute(sql`
    select opt as option, count(*)::int as count
    from feedback f, jsonb_array_elements_text(coalesce(f.answers->'improve', '[]'::jsonb)) opt
    where f.brand_id = ${brandId} and f.created_at >= ${from} and f.created_at < ${to}
    group by opt order by count(*) desc limit 10`);
  const t = totals.rows[0] as Record<string, unknown>;
  return {
    bills: Number(t.bills),
    sent: Number(t.sent),
    opened: Number(t.opened),
    responses: Number(t.responses),
    avgRating: num(t.avg_rating),
    nps: num(t.nps),
    openTickets: Number(t.open_tickets),
    revenue: Number(t.revenue),
    byStore: byStore.rows.map((r) => ({ store: String(r.store), bills: Number(r.bills), opened: Number(r.opened), responses: Number(r.responses), avgRating: num(r.avg_rating), nps: num(r.nps) })),
    byDay: byDay.rows.map((r) => ({ day: String(r.day), bills: Number(r.bills), opened: Number(r.opened), responses: Number(r.responses), avgRating: num(r.avg_rating) })),
    themes: themes.rows.map((r) => ({ option: String(r.option), count: Number(r.count) })),
  };
}
