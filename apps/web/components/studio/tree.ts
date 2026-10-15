import type { Block } from "@leksy/template-engine";

/** Where a block lives: the array that holds it and its index. Blocks may sit inside columns. */
export interface Loc {
  list: Block[];
  index: number;
  parentId: string | null;
  column: number | null;
}

export function locate(blocks: Block[], id: string, parentId: string | null = null, column: number | null = null): Loc | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.id === id) return { list: blocks, index: i, parentId, column };
    if (b.type === "columns") {
      for (let c = 0; c < b.props.columns.length; c++) {
        const hit = locate(b.props.columns[c]!, id, b.id, c);
        if (hit) return hit;
      }
    }
  }
  return null;
}

export function findBlock(blocks: Block[], id: string | null): Block | null {
  if (!id) return null;
  const loc = locate(blocks, id);
  return loc ? loc.list[loc.index]! : null;
}

/** Immutable update helper: clone the tree, then mutate the clone. */
export function edit(blocks: Block[], fn: (draft: Block[]) => void): Block[] {
  const copy = structuredClone(blocks);
  fn(copy);
  return copy;
}

/** List of a column (or the root) by key: "root" or "<columnsId>:<index>". */
export function listByKey(blocks: Block[], key: string): Block[] | null {
  if (key === "root") return blocks;
  const [id, c] = key.split(":");
  const b = findBlock(blocks, id!);
  return b && b.type === "columns" ? (b.props.columns[Number(c)] ?? null) : null;
}

export function keyOf(loc: Loc): string {
  return loc.parentId ? `${loc.parentId}:${loc.column}` : "root";
}
