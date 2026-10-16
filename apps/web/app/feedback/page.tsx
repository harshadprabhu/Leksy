"use client";
import { useState } from "react";
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
  const { data, reload } = useApi<{ feedback: Row[]; total?: number }>(`/v1/feedback?limit=100${ticket ? `&ticket=${ticket}` : ""}`);
  const update = async (id: string, ticketStatus: Row["ticketStatus"]) => {
    const note = ticketStatus === "resolved" ? (prompt("How was it resolved?") ?? undefined) : undefined;
    await api(`/v1/feedback/${id}`, { method: "PATCH", body: { ticketStatus, resolutionNote: note } });
    await reload();
  };
  return (
    <Shell>
      <div className="head">
        <div>
          <h1>Mission Happiness</h1>
          <div className="muted">Every response, with low scores turned into tickets for the store team.</div>
        </div>
        <div className="seg">
          {FILTERS.map(([k, l]) => (
            <button key={k} className={ticket === k ? "on" : ""} onClick={() => setTicket(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="card">
        <table className="t">
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
                  <td className="muted">{dt(f.createdAt)}</td>
                  <td>{f.storeCode}</td>
                  <td>{f.staffId ?? "–"}</td>
                  <td>
                    <span className={`badge ${f.rating <= 2 ? "bad" : f.rating >= 4 ? "good" : "warn"}`}>{f.rating}★</span>
                  </td>
                  <td>{f.nps ?? "–"}</td>
                  <td>
                    {issues.length > 0 && <div className="small">{issues.join(" · ")}</div>}
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
