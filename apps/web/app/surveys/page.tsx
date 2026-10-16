"use client";
import { SURVEY_CSS, SURVEY_JS, SurveySchema, surveyHtml, type Question, type Survey } from "@leksy/survey";
import { useEffect, useMemo, useState } from "react";
import { Shell } from "@/components/Shell";
import { api, dt } from "@/lib/api";
import { useApi } from "@/lib/useApi";

interface Row {
  key: string;
  name: string;
  body: Survey;
  alertThreshold: number;
  reviewThreshold: number;
  slaMinutes: number;
  updatedAt?: string;
}

const TYPES: [Question["type"], string][] = [
  ["rating", "Rating (1–5)"],
  ["nps", "Recommend (0–10)"],
  ["choice", "Pick one"],
  ["multi", "Pick several"],
  ["text", "Free text"],
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "q";

/** Makes an id from the label that no other question uses. */
function uniqueId(label: string, taken: string[]) {
  const base = slug(label);
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}_${i}`.slice(0, 40);
  return id;
}

const PREVIEW_JS = `<script>window.LX_SUBMIT=function(){return Promise.resolve({ok:true,j:{}});};</script>`;

/** Mission Happiness survey builder: questions, branching, alerts and a live phone preview. */
export default function Surveys() {
  const { data, reload } = useApi<{ surveys: Row[] }>("/v1/surveys");
  const [edit, setEdit] = useState<Row | null>(null);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data && !edit && data.surveys[0]) setEdit(structuredClone(data.surveys[0]));
  }, [data, edit]);

  const change = (next: Row) => {
    setEdit(next);
    setDirty(true);
    setMsg(null);
  };
  const setBody = (patch: Partial<Survey>) => edit && change({ ...edit, body: { ...edit.body, ...patch } });
  const setQ = (i: number, patch: Partial<Question>) => edit && setBody({ questions: edit.body.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const moveQ = (i: number, dir: -1 | 1) => {
    if (!edit) return;
    const qs = [...edit.body.questions];
    const to = i + dir;
    if (to < 0 || to >= qs.length) return;
    [qs[i], qs[to]] = [qs[to]!, qs[i]!];
    setBody({ questions: qs });
  };
  const removeQ = (i: number) => {
    if (!edit) return;
    const gone = edit.body.questions[i]!.id;
    if (gone === edit.body.primary) return setMsg("This is the happiness question that drives alerts. Pick another one first.");
    // Questions that depended on the removed one become unconditional.
    setBody({ questions: edit.body.questions.filter((_, j) => j !== i).map((q) => (q.showIf?.question === gone ? { ...q, showIf: undefined } : q)) });
  };
  const addQ = (type: Question["type"]) => {
    if (!edit) return;
    const label = type === "text" ? "Anything else you'd like to tell us?" : type === "nps" ? "How likely are you to recommend us?" : type === "rating" ? "How would you rate…?" : "Which of these…?";
    const q: Question = { id: uniqueId(label, edit.body.questions.map((x) => x.id)), type, label, required: false, ...(type === "choice" || type === "multi" ? { options: ["Option 1", "Option 2"] } : {}) };
    setBody({ questions: [...edit.body.questions, q] });
  };

  const check = useMemo(() => (edit ? SurveySchema.safeParse(edit.body) : null), [edit]);
  const primaryOk = !!edit && edit.body.questions.some((q) => q.id === edit.body.primary && q.type === "rating");

  const preview = useMemo(() => {
    if (!edit) return "";
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;font-family:Inter,system-ui,sans-serif;background:#fbf8f2;color:#2a2118;font-size:14px}.lx-button{display:inline-block;padding:10px 18px;border-radius:999px;background:#b08d57;color:#fff;font-weight:600}h3{font-family:Georgia,serif;font-weight:500}${SURVEY_CSS}</style>${PREVIEW_JS}</head><body>${surveyHtml(edit.body, edit.body.title, false)}<script>${SURVEY_JS}</script></body></html>`;
  }, [edit]);

  const save = async () => {
    if (!edit || !check?.success || !primaryOk) return;
    try {
      await api(`/v1/surveys/${edit.key}`, { method: "PUT", body: { name: edit.name, body: check.data, alertThreshold: edit.alertThreshold, reviewThreshold: edit.reviewThreshold, slaMinutes: edit.slaMinutes } });
      setDirty(false);
      setMsg("Saved. Customers see this survey on their next bill.");
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const newSurvey = () => {
    const name = prompt("Name the new survey (e.g. Wedding collection feedback)");
    if (!name || !edit) return;
    const key = slug(name).replace(/_/g, "-");
    if (data?.surveys.some((x) => x.key === key)) return setMsg("A survey with that name already exists.");
    setEdit({ ...structuredClone(edit), key, name, body: { ...structuredClone(edit.body), title: name } });
    setDirty(true);
  };

  if (!edit) return <Shell>Loading…</Shell>;
  const earlier = (i: number) => edit.body.questions.slice(0, i);

  return (
    <Shell>
      <div className="head">
        <div>
          <h1>Survey editor</h1>
          <div className="muted">Choose what customers are asked on every bill, and when the store team is alerted.</div>
        </div>
        <div className="row">
          <select
            value={edit.key}
            onChange={(e) => {
              if (dirty && !confirm("Discard unsaved changes?")) return;
              const row = data?.surveys.find((x) => x.key === e.target.value);
              if (row) {
                setEdit(structuredClone(row));
                setDirty(false);
              }
            }}
          >
            {data?.surveys.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
            {!data?.surveys.some((x) => x.key === edit.key) && <option value={edit.key}>{edit.name} (new)</option>}
          </select>
          <button className="btn" onClick={newSurvey}>
            New survey
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={!dirty || !check?.success || !primaryOk}>
            Save survey
          </button>
        </div>
      </div>
      {msg && <div className="card small" style={{ marginBottom: 12 }}>{msg}</div>}
      <div className="grid" style={{ gridTemplateColumns: "minmax(0,1.5fr) minmax(320px,1fr)", alignItems: "start" }}>
        <div className="stack">
          <div className="card stack">
            <div className="row">
              <label className="f" style={{ flex: 1 }}>
                Survey name (internal)
                <input value={edit.name} onChange={(e) => change({ ...edit, name: e.target.value })} />
              </label>
              <label className="f" style={{ flex: 1 }}>
                Heading customers see
                <input value={edit.body.title} onChange={(e) => setBody({ title: e.target.value })} />
              </label>
            </div>
            <label className="f">
              Thank-you message
              <input value={edit.body.thankYou} onChange={(e) => setBody({ thankYou: e.target.value })} />
            </label>
            <div className="small muted">
              Survey key <span className="mono">{edit.key}</span>. Pick it in a trigger to use it for those bills.
              {edit.updatedAt && ` Last saved ${dt(edit.updatedAt)}.`}
            </div>
          </div>

          <div className="card stack">
            <h2 style={{ margin: 0 }}>Questions</h2>
            {edit.body.questions.map((q, i) => (
              <div key={i} className="card stack" style={{ padding: 12, gap: 8, borderColor: q.id === edit.body.primary ? "var(--accent)" : undefined }}>
                <div className="row">
                  <span className="badge">{i + 1}</span>
                  <select value={q.type} onChange={(e) => setQ(i, { type: e.target.value as Question["type"], ...(["choice", "multi"].includes(e.target.value) && !q.options?.length ? { options: ["Option 1", "Option 2"] } : {}) })}>
                    {TYPES.map(([t, l]) => (
                      <option key={t} value={t}>
                        {l}
                      </option>
                    ))}
                  </select>
                  {q.type === "rating" && (
                    <select aria-label="Rating style" value={q.style ?? "stars"} onChange={(e) => setQ(i, { style: e.target.value as "faces" | "stars" })}>
                      <option value="faces">😞→😄 Faces</option>
                      <option value="stars">★ Stars</option>
                    </select>
                  )}
                  {q.id === edit.body.primary && <span className="badge good">Happiness score</span>}
                  <div style={{ flex: 1 }} />
                  <button className="btn sm" onClick={() => moveQ(i, -1)} title="Move up">
                    ↑
                  </button>
                  <button className="btn sm" onClick={() => moveQ(i, 1)} title="Move down">
                    ↓
                  </button>
                  <button className="btn sm danger" onClick={() => removeQ(i)}>
                    Delete
                  </button>
                </div>
                <input value={q.label} onChange={(e) => setQ(i, { label: e.target.value })} placeholder="Question" />
                {(q.type === "choice" || q.type === "multi") && (
                  <div className="stack" style={{ gap: 4 }}>
                    <span className="small muted">Options (one per line)</span>
                    <textarea
                      rows={Math.max(2, (q.options ?? []).length)}
                      value={(q.options ?? []).join("\n")}
                      onChange={(e) => setQ(i, { options: e.target.value.split("\n").map((o) => o.slice(0, 80)).slice(0, 20) })}
                    />
                  </div>
                )}
                <div className="row small">
                  <label className="row">
                    <input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> Required
                  </label>
                  {q.type === "rating" && q.id !== edit.body.primary && (
                    <button className="btn sm" onClick={() => setBody({ primary: q.id })}>
                      Use as happiness score
                    </button>
                  )}
                  <span className="muted mono" title="Answers are stored under this id">
                    id: {q.id}
                  </span>
                </div>
                {i > 0 && (
                  <div className="row small">
                    <label className="row">
                      <input
                        type="checkbox"
                        checked={!!q.showIf}
                        onChange={(e) => {
                          const first = earlier(i).find((x) => x.type === "rating" || x.type === "nps") ?? earlier(i)[0]!;
                          setQ(i, { showIf: e.target.checked ? { question: first.id, op: first.type === "rating" || first.type === "nps" ? "lte" : "eq", value: first.type === "rating" ? 3 : (first.options?.[0] ?? "") } : undefined });
                        }}
                      />
                      Only ask when
                    </label>
                    {q.showIf && (
                      <>
                        <select value={q.showIf.question} onChange={(e) => setQ(i, { showIf: { ...q.showIf!, question: e.target.value } })}>
                          {earlier(i).map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.label.slice(0, 40)}
                            </option>
                          ))}
                        </select>
                        <select value={q.showIf.op} onChange={(e) => setQ(i, { showIf: { ...q.showIf!, op: e.target.value as "lte" } })}>
                          <option value="lte">is at most</option>
                          <option value="gte">is at least</option>
                          <option value="eq">is</option>
                          <option value="includes">includes</option>
                        </select>
                        <input
                          style={{ width: 120 }}
                          value={String(q.showIf.value)}
                          onChange={(e) => setQ(i, { showIf: { ...q.showIf!, value: e.target.value !== "" && !isNaN(Number(e.target.value)) ? Number(e.target.value) : e.target.value } })}
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div className="row">
              <span className="small muted">Add:</span>
              {TYPES.map(([t, l]) => (
                <button key={t} className="btn sm" onClick={() => addQ(t)}>
                  + {l}
                </button>
              ))}
            </div>
            {check && !check.success && (
              <div className="err small">
                {check.error.issues.slice(0, 4).map((x, i) => (
                  <div key={i}>
                    {x.path.join(".")}: {x.message}
                  </div>
                ))}
              </div>
            )}
            {!primaryOk && <div className="err small">Choose a star-rating question as the happiness score.</div>}
            <div className="small muted">A &ldquo;Pick several&rdquo; question with id <span className="mono">improve</span> feeds the dashboard&apos;s &ldquo;What customers want fixed&rdquo; chart.</div>
          </div>

          <div className="card stack">
            <h2 style={{ margin: 0 }}>Closed loop</h2>
            <div className="row">
              <label className="f">
                Alert the store manager when the score is at most
                <select value={edit.alertThreshold} onChange={(e) => change({ ...edit, alertThreshold: Number(e.target.value) })}>
                  {[0, 1, 2, 3].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "never" : `${n} star${n > 1 ? "s" : ""}`}
                    </option>
                  ))}
                </select>
              </label>
              <label className="f">
                Resolve within
                <select value={edit.slaMinutes} onChange={(e) => change({ ...edit, slaMinutes: Number(e.target.value) })}>
                  {[60, 120, 240, 480, 1440].map((m) => (
                    <option key={m} value={m}>
                      {m < 1440 ? `${m / 60} hour${m > 60 ? "s" : ""}` : "1 day"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="f">
                Ask for a Google review at
                <select value={edit.reviewThreshold} onChange={(e) => change({ ...edit, reviewThreshold: Number(e.target.value) })}>
                  {[4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n === 6 ? "never" : `${n}+ stars`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>

        <div className="card stack" style={{ position: "sticky", top: 16 }}>
          <div className="spread">
            <h2 style={{ margin: 0 }}>Live preview</h2>
            <span className="small muted">Try it: branches open as you answer</span>
          </div>
          <iframe title="Survey preview" sandbox="allow-scripts allow-forms" srcDoc={preview} style={{ width: "100%", height: 640, border: "1px solid var(--line)", borderRadius: 16, background: "#fbf8f2" }} />
        </div>
      </div>
    </Shell>
  );
}
