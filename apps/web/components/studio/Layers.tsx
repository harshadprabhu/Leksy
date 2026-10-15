"use client";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Block } from "@leksy/template-engine";
import { blockTitle, LABEL } from "./catalog";

type Props = {
  blocks: Block[];
  selected: string | null;
  /** Selected column container, e.g. "<columnsId>:1"; new blocks go there. */
  selectedList: string;
  onSelect: (id: string) => void;
  onSelectList: (key: string) => void;
  onReorder: (listKey: string, from: number, to: number) => void;
};

/** The block tree. Drag the grip to reorder; columns show their contents indented. */
export function Layers(props: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  return <List {...props} listKey="root" list={props.blocks} sensors={sensors} depth={0} />;
}

function List(p: Props & { listKey: string; list: Block[]; sensors: ReturnType<typeof useSensors>; depth: number }) {
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = p.list.findIndex((b) => b.id === e.active.id);
    const to = p.list.findIndex((b) => b.id === e.over!.id);
    if (from >= 0 && to >= 0) p.onReorder(p.listKey, from, to);
  };
  return (
    <DndContext sensors={p.sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={p.list.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div className="stack" style={{ gap: 2, marginLeft: p.depth ? 14 : 0 }}>
          {p.list.map((b) => (
            <Row key={b.id} block={b} {...p} />
          ))}
          {p.depth > 0 && p.list.length === 0 && <div className="small muted" style={{ padding: "4px 8px" }}>Empty</div>}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function Row(p: Props & { block: Block; sensors: ReturnType<typeof useSensors>; depth: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.block.id });
  const b = p.block;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}>
      <div className={`layer ${p.selected === b.id ? "on" : ""} ${b.visibleIf ? "hiddenrule" : ""}`} onClick={() => p.onSelect(b.id)} title={b.visibleIf ? "Shown only when its rule matches" : undefined}>
        <span className="grip" {...attributes} {...listeners} aria-label="Drag to reorder">
          ⋮⋮
        </span>
        <span className="name">{blockTitle(b)}</span>
        <span className="kind">{LABEL[b.type]}</span>
      </div>
      {b.type === "columns" &&
        b.props.columns.map((col, i) => {
          const key = `${b.id}:${i}`;
          return (
            <div key={key} style={{ marginLeft: 14 }}>
              <div className={`layer ${p.selectedList === key ? "on" : ""}`} onClick={() => p.onSelectList(key)} style={{ fontSize: 12 }}>
                <span className="name muted">Column {i + 1}</span>
              </div>
              <List {...p} listKey={key} list={col} depth={1} />
            </div>
          );
        })}
    </div>
  );
}

export { arrayMove };
