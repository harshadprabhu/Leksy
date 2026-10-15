"use client";
import { renderDocument, TemplateSchema, type Block, type Template } from "@leksy/template-engine";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, dt } from "@/lib/api";
import { BindingProvider } from "./binding";
import { CATALOG, cloneBlock } from "./catalog";
import { FieldPicker, type FieldInfo } from "./FieldPicker";
import { Inspector, PageEditor } from "./Inspector";
import { arrayMove, Layers } from "./Layers";
import { edit, findBlock, keyOf, listByKey, locate } from "./tree";

interface TemplateRow {
  id: string;
  key: string;
  name: string;
  draft: Template;
  publishedVersion: number | null;
  updatedAt: string;
}

interface BillOption {
  id: string;
  invoiceNo: string;
  storeCode: string;
}

const WIDTH = { mobile: 420, a4: 820, thermal: 330 } as const;

/** Script inside the preview frame: report clicks on blocks to the studio. */
const FRAME_SCRIPT = `<script>document.addEventListener('click',function(e){var el=e.target.closest('[data-block-id]');if(el){e.preventDefault();parent.postMessage({lxSelect:el.getAttribute('data-block-id')},'*');}},true);
function h(){parent.postMessage({lxHeight:document.documentElement.scrollHeight},'*');}new ResizeObserver(h).observe(document.body);window.addEventListener('load',h);</script>`;

export function Studio({ id }: { id: string }) {
  const [row, setRow] = useState<TemplateRow | null>(null);
  const [tpl, setTpl] = useState<Template | null>(null);
  const [history, setHistory] = useState<{ past: Template[]; future: Template[] }>({ past: [], future: [] });
  const [selected, setSelected] = useState<string | null>(null);
  const [targetList, setTargetList] = useState("root");
  const [fields, setFields] = useState<FieldInfo[]>([]);
  const [ctx, setCtx] = useState<Record<string, unknown>>({});
  const [bills, setBills] = useState<BillOption[]>([]);
  const [billId, setBillId] = useState("");
  const [tab, setTab] = useState<"block" | "page" | "data">("block");
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [device, setDevice] = useState<"page" | "mobile">("page");
  const [frameHeight, setFrameHeight] = useState(900);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    void (async () => {
      const t = await api<TemplateRow>(`/v1/templates/${id}`);
      setRow(t);
      setTpl(TemplateSchema.parse(t.draft));
      const b = await api<{ bills: BillOption[] }>("/v1/bills?limit=25");
      setBills(b.bills);
    })().catch((e) => setStatus((e as Error).message));
  }, [id]);

  // Data for the preview and the field picker: a real bill, or the brand's latest / the sample.
  useEffect(() => {
    void api<{ fields: FieldInfo[]; context: Record<string, unknown> }>(`/v1/templates/fields${billId ? `?billId=${billId}` : ""}`).then((r) => {
      setFields(r.fields);
      setCtx(r.context);
    });
  }, [billId]);

  // Clicks inside the preview select the block.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      if (typeof e.data?.lxSelect === "string") {
        setSelected(e.data.lxSelect);
        setTab("block");
      }
      if (typeof e.data?.lxHeight === "number") setFrameHeight(Math.min(20000, Math.max(400, e.data.lxHeight)));
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, []);

  /** Every change goes through here so undo/redo works. */
  const change = useCallback(
    (next: Template) => {
      if (!tpl) return;
      setHistory((h) => ({ past: [...h.past.slice(-99), tpl], future: [] }));
      setTpl(next);
      setDirty(true);
    },
    [tpl],
  );
  const undo = () => {
    const prev = history.past.at(-1);
    if (!prev || !tpl) return;
    setHistory({ past: history.past.slice(0, -1), future: [tpl, ...history.future] });
    setTpl(prev);
    setDirty(true);
  };
  const redo = () => {
    const next = history.future[0];
    if (!next || !tpl) return;
    setHistory({ past: [...history.past, tpl], future: history.future.slice(1) });
    setTpl(next);
    setDirty(true);
  };

  const setBlocks = (fn: (b: Block[]) => void) => tpl && change({ ...tpl, blocks: edit(tpl.blocks, fn) });

  const addBlock = (make: () => Block) => {
    const b = make();
    setBlocks((blocks) => {
      // Insert after the selected block in its own list, else at the end of the chosen list.
      const loc = selected ? locate(blocks, selected) : null;
      if (loc && keyOf(loc) === targetList) loc.list.splice(loc.index + 1, 0, b);
      else (listByKey(blocks, targetList) ?? blocks).push(b);
    });
    setSelected(b.id);
    setTab("block");
  };

  const updateBlock = (b: Block) =>
    setBlocks((blocks) => {
      const loc = locate(blocks, b.id);
      if (loc) loc.list[loc.index] = b;
    });

  const removeSelected = () => {
    if (!selected) return;
    setBlocks((blocks) => {
      const loc = locate(blocks, selected);
      if (loc) loc.list.splice(loc.index, 1);
    });
    setSelected(null);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    let copyId = "";
    setBlocks((blocks) => {
      const loc = locate(blocks, selected);
      if (!loc) return;
      const copy = cloneBlock(loc.list[loc.index]!);
      copyId = copy.id;
      loc.list.splice(loc.index + 1, 0, copy);
    });
    if (copyId) setSelected(copyId);
  };

  const move = (dir: -1 | 1) => {
    if (!selected) return;
    setBlocks((blocks) => {
      const loc = locate(blocks, selected);
      if (!loc) return;
      const to = loc.index + dir;
      if (to < 0 || to >= loc.list.length) return;
      const [b] = loc.list.splice(loc.index, 1);
      loc.list.splice(to, 0, b!);
    });
  };

  const reorder = (key: string, from: number, to: number) =>
    setBlocks((blocks) => {
      const list = listByKey(blocks, key);
      if (!list) return;
      const moved = arrayMove(list, from, to);
      list.splice(0, list.length, ...moved);
    });

  // Keyboard shortcuts: undo/redo, delete, duplicate.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (!typing && (e.key === "Delete" || e.key === "Backspace") && selected) {
        e.preventDefault();
        removeSelected();
      } else if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && selected) {
        e.preventDefault();
        duplicateSelected();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const save = async () => {
    if (!tpl || !row) return false;
    setStatus("Saving…");
    try {
      const r = await api<TemplateRow>(`/v1/templates/${row.id}`, { method: "PUT", body: { draft: tpl, name: tpl.name } });
      setRow(r);
      setDirty(false);
      setStatus(`Draft saved ${dt(r.updatedAt)}`);
      return true;
    } catch (e) {
      setStatus(`Save failed: ${(e as Error).message}`);
      return false;
    }
  };

  const publish = async () => {
    if (!row || !(await save())) return;
    const r = await api<{ version: number }>(`/v1/templates/${row.id}/publish`, { body: {} });
    setRow({ ...row, publishedVersion: r.version });
    setStatus(`Published version ${r.version}. New bills use it now.`);
  };

  // Live preview, rendered in the browser with the same engine the server uses.
  const html = useMemo(() => {
    if (!tpl) return "";
    const page = device === "mobile" ? { ...tpl.page, format: "mobile" as const } : tpl.page;
    const doc = renderDocument({ ...tpl, page }, ctx, { editor: true });
    const highlight = selected ? `<style>[data-block-id="${selected.replace(/[^\w-]/g, "")}"]{outline:2px solid #9c7a45;outline-offset:3px;border-radius:4px}</style>` : "";
    return doc.replace("</head>", `${highlight}<style>[data-block-id]{cursor:pointer}[data-block-id]:hover{outline:1px dashed #9c7a45;outline-offset:3px}</style></head>`).replace("</body>", `${FRAME_SCRIPT}</body>`);
  }, [tpl, ctx, selected, device]);

  if (!tpl || !row) return <div className="empty">{status ?? "Loading studio…"}</div>;
  const block = findBlock(tpl.blocks, selected);
  const width = device === "mobile" ? WIDTH.mobile : WIDTH[tpl.page.format];

  return (
    <BindingProvider>
      <div className="studio-wrap">
        <div className="studio-top">
          <Link href="/studio" className="btn sm">
            ← Templates
          </Link>
          <input value={tpl.name} onChange={(e) => change({ ...tpl, name: e.target.value })} style={{ fontWeight: 600, width: 220 }} aria-label="Template name" />
          <span className="badge">{row.publishedVersion ? `Live: v${row.publishedVersion}` : "Not published"}</span>
          {dirty && <span className="badge warn">Unsaved</span>}
          <div style={{ flex: 1 }} />
          <select value={billId} onChange={(e) => setBillId(e.target.value)} title="Preview with this bill">
            <option value="">Preview: latest bill / sample</option>
            {bills.map((b) => (
              <option key={b.id} value={b.id}>
                {b.invoiceNo} · {b.storeCode}
              </option>
            ))}
          </select>
          <div className="seg">
            <button className={device === "page" ? "on" : ""} onClick={() => setDevice("page")}>
              {tpl.page.format === "a4" ? "A4" : tpl.page.format === "thermal" ? "Thermal" : "Page"}
            </button>
            <button className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")}>
              Phone
            </button>
          </div>
          <button className="btn sm" onClick={undo} disabled={!history.past.length} title="Undo (Ctrl+Z)">
            ↶
          </button>
          <button className="btn sm" onClick={redo} disabled={!history.future.length} title="Redo (Ctrl+Shift+Z)">
            ↷
          </button>
          <button className="btn" onClick={() => void save()} disabled={!dirty}>
            Save draft
          </button>
          <button className="btn primary" onClick={() => void publish()}>
            Publish
          </button>
        </div>
        <div className="studio-body">
          <div className="pane left">
            <h3>Add a block</h3>
            <div className="small muted" style={{ marginBottom: 6 }}>
              Adds {targetList === "root" ? "below the selected block" : "into the selected column"}
            </div>
            <div className="palette">
              {CATALOG.map((c) => (
                <button key={c.type} onClick={() => addBlock(c.make)}>
                  + {c.label}
                </button>
              ))}
            </div>
            <div className="spread">
              <h3>Layers</h3>
              {targetList !== "root" && (
                <button className="btn sm" onClick={() => setTargetList("root")}>
                  Add to page
                </button>
              )}
            </div>
            <Layers
              blocks={tpl.blocks}
              selected={selected}
              selectedList={targetList}
              onSelect={(bid) => {
                setSelected(bid);
                const loc = locate(tpl.blocks, bid);
                if (loc) setTargetList(keyOf(loc));
                setTab("block");
              }}
              onSelectList={(key) => {
                setTargetList(key);
                setSelected(null);
              }}
              onReorder={reorder}
            />
          </div>
          <div className="canvas">
            <iframe ref={frame} title="Bill preview" sandbox="allow-scripts" srcDoc={html} style={{ width, height: frameHeight }} />
          </div>
          <div className="pane right">
            <div className="tabs">
              <button className={tab === "block" ? "on" : ""} onClick={() => setTab("block")}>
                Block
              </button>
              <button className={tab === "data" ? "on" : ""} onClick={() => setTab("data")}>
                Data fields
              </button>
              <button className={tab === "page" ? "on" : ""} onClick={() => setTab("page")}>
                Page
              </button>
            </div>
            {tab === "block" &&
              (block ? (
                <div className="stack">
                  <div className="row">
                    <button className="btn sm" onClick={() => move(-1)} title="Move up">
                      ↑
                    </button>
                    <button className="btn sm" onClick={() => move(1)} title="Move down">
                      ↓
                    </button>
                    <button className="btn sm" onClick={duplicateSelected} title="Duplicate (Ctrl+D)">
                      Duplicate
                    </button>
                    <button className="btn sm danger" onClick={removeSelected} title="Delete">
                      Delete
                    </button>
                  </div>
                  <Inspector key={block.id} block={block} fields={fields} onChange={updateBlock} />
                  <div className="sect">
                    <h3>Insert a field</h3>
                    <FieldPicker fields={fields} />
                  </div>
                </div>
              ) : (
                <div className="empty">Click a block on the bill or in Layers to edit it.</div>
              ))}
            {tab === "data" && <FieldPicker fields={fields} />}
            {tab === "page" && <PageEditor page={tpl.page} onChange={(page) => change({ ...tpl, page })} />}
            {status && <div className="small muted" style={{ marginTop: 12 }}>{status}</div>}
          </div>
        </div>
      </div>
    </BindingProvider>
  );
}
