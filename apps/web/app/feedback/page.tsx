"use client";
import { useState } from "react";
import { Face, FACE_COLORS, FACE_LABELS, PageHero } from "@/components/PageHero";
import { Shell } from "@/components/Shell";
import { api, dt } from "@/lib/api";
import { useApi } from "@/lib/useApi";

interface Row {
  id: string;
  storeCode: string;
  staffId: string | null;
  rating: number;
  nps: number | null;
  answers: Record<string, unknown>;
  comment: string | null;
  ticketStatus: "none" | "open" | "in_progress" | "resolved";
  slaDueAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
}

const FILTERS = [
  ["", "All"],
  ["open", "Open tickets"],
  ["in_progress", "In progress"],
  ["resolved", "Resolved"],
] as const;

export default function Feedback() {
  const [ticket, setTicket] = useState("");
  const kpi = useApi<{ responses: number; avgRating: number | null; nps: number | null; openTickets: number }>("/v1/analytics/summary");
  const stores = useApi<{ stores: { code: string; name: string }[] }>("/v1/stores");
  const names = new Map((stores.data?.stores ?? []).map((x) => [x.code, x.name]));
  const { data, reload } = useApi<{ feedback: Row[]; total?: number; dist?: number[] }>(`/v1/feedback?limit=100${ticket ? `&ticket=${ticket}` : ""}`);
  const update = async (id: string, ticketStatus: Row["ticketStatus"]) => {
    const note = ticketStatus === "resolved" ? (prompt("How was it resolved?") ?? undefined) : undefined;
    await api(`/v1/feedback/${id}`, { method: "PATCH", body: { ticketStatus, resolutionNote: note } });
    await reload();
  };
  return (
    <Shell>
      <PageHero
        kicker="Mission Happiness"
        title="How your customers feel"
        sub="Every response from the bill, with unhappy customers turned into tickets for the store team."
        stats={
          kpi.data
            ? [
                { value: kpi.data.responses.toLocaleString("en-IN"), label: "responses, last 30 days" },
                { value: kpi.data.avgRating != null ? `${kpi.data.avgRating.toFixed(2)} ★` : "–", label: "average happiness" },
                { value: kpi.data.nps != null ? String(Math.round(kpi.data.nps)) : "–", label: "NPS" },
                { value: String(kpi.data.openTickets), label: "open tickets" },
              ]
            : []
        }
      />

      {data?.dist && (
        <div className="card faces-dist">
          <div className="spread">
            <h2 style={{ margin: 0 }}>What customers tapped</h2>
            <span className="small muted">{(data.total ?? 0).toLocaleString("en-IN")} itemised responses in this inbox{ticket ? " with this ticket status" : ""}</span>
          </div>
          <div className="faces-row">
            {data.dist.map((n, i) => {
              const total = Math.max(1, data.dist!.reduce((a, b) => a + b, 0));
              const most = Math.max(1, ...data.dist!);
              return (
                <div key={i} className="face-col" style={{ "--fc": FACE_COLORS[i] } as React.CSSProperties}>
                  <Face rating={i + 1} size={40} />
                  <b>{((100 * n) / total).toFixed(0)}%</b>
                  <div className="face-track">
                    <i style={{ height: `${(100 * n) / most}%` }} />
                  </div>
                  <span className="small">{FACE_LABELS[i]}</span>
                  <span className="small muted">{n.toLocaleString("en-IN")}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="spread" style={{ margin: "14px 0 10px" }}>
        <h2 style={{ margin: 0 }}>Responses</h2>
        <div className="seg">
          {FILTERS.map(([k, l]) => (
            <button key={k} className={ticket === k ? "on" : ""} onClick={() => setTicket(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <table className="t branded">
          <thead>
            <tr>
              <th>When</th>
              <th>Store</th>
              <th>Staff</th>
              <th>Rating</th>
              <th>NPS</th>
              <th>What they said</th>
              <th>Ticket</th>
            </tr>
          </thead>
          <tbody>
            {data?.feedback.map((f) => {
              const late = f.ticketStatus === "open" && f.slaDueAt && new Date(f.slaDueAt) < new Date();
              const issues = [...((f.answers.improve as string[]) ?? []), ...((f.answers.loved as string[]) ?? []).map((x) => `♥ ${x}`)];
              // Answers to questions a brand added in the survey editor.
              const SHOWN = new Set(["overall", "improve", "loved", "nps", "comment"]);
              const extra = Object.entries(f.answers)
                .filter(([k, v]) => !SHOWN.has(k) && v !== "" && v != null && !(typeof v === "string" && v === f.comment))
                .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
              return (
                <tr key={f.id}>
                  <td className="muted nowrap">{dt(f.createdAt)}</td>
                  <td>
                    {names.get(f.storeCode) ?? f.storeCode} <span className="muted small mono">{f.storeCode}</span>
                  </td>
                  <td>{f.staffId ?? "–"}</td>
                  <td>
                    <span className="face-cell" title={FACE_LABELS[f.rating - 1]}>
                      <Face rating={f.rating} size={26} /> {f.rating}
                    </span>
                  </td>
                  <td>{f.nps ?? "–"}</td>
                  <td>
                    {issues.length > 0 && (
                      <div className="tags">
                        {issues.map((x) => (
                          <span key={x} className={`tag ${x.startsWith("♥") ? "love" : "fix"}`}>
                            {x}
                          </span>
                        ))}
                      </div>
                    )}
                    {f.comment && <div className="small muted">“{f.comment}”</div>}
                    {extra.length > 0 && <div className="small muted">{extra.join(" · ")}</div>}
                  </td>
                  <td>
                    {f.ticketStatus === "none" ? (
                      "–"
                    ) : (
                      <div className="stack" style={{ gap: 4 }}>
                        <span className={`badge ${f.ticketStatus === "resolved" ? "good" : late ? "bad" : "warn"}`}>{late ? "SLA missed" : f.ticketStatus.replace("_", " ")}</span>
                        {f.ticketStatus !== "resolved" && (
                          <div className="row">
                            {f.ticketStatus === "open" && (
                              <button className="btn sm" onClick={() => void update(f.id, "in_progress")}>
                                Start
                              </button>
                            )}
                            <button className="btn sm" onClick={() => void update(f.id, "resolved")}>
                              Resolve
                            </button>
                          </div>
                        )}
                        {f.resolutionNote && <div className="small muted">{f.resolutionNote}</div>}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && !data.feedback.length && <div className="empty">No responses yet.</div>}
        {data?.total != null && data.total > data.feedback.length && <div className="small muted">Showing the latest {data.feedback.length} of {data.total.toLocaleString("en-IN")} responses.</div>}
      </div>
    </Shell>
  );
}
