"use client";
import { createContext, useContext, useRef } from "react";

/**
 * The field picker inserts {{path}} into whichever text box was focused last.
 * Inputs inside an item list ("items") get paths relative to the item.
 */
interface Target {
  insert: (path: string) => void;
  scope?: string;
}

const Ctx = createContext<{ current: React.MutableRefObject<Target | null> } | null>(null);

export function BindingProvider({ children }: { children: React.ReactNode }) {
  const current = useRef<Target | null>(null);
  return <Ctx.Provider value={{ current }}>{children}</Ctx.Provider>;
}

export function useBinding() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("BindingProvider missing");
  return ctx.current;
}

/** Relative path for an item-scoped input: "items[].jewellery.huid" → "jewellery.huid". */
export function scopedPath(path: string, scope?: string): string {
  if (scope && path.startsWith(`${scope}[].`)) return path.slice(scope.length + 3);
  return path;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  scope?: string;
  multiline?: boolean;
  placeholder?: string;
};

/** A text box that accepts {{field}} tokens from the picker at the cursor. */
export function BoundInput({ value, onChange, scope, multiline, placeholder }: Props) {
  const target = useBinding();
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Always insert into the latest value, not the one seen when the box was focused.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const register = () => {
    target.current = {
      scope,
      insert: (path) => {
        const el = ref.current;
        const { value: cur, onChange: set } = latest.current;
        const token = `{{${scopedPath(path, scope)}}}`;
        if (!el) return set(cur + token);
        const start = el.selectionStart ?? cur.length;
        const end = el.selectionEnd ?? cur.length;
        const next = cur.slice(0, start) + token + cur.slice(end);
        set(next);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(start + token.length, start + token.length);
        });
      },
    };
  };
  const common = { ref, value, placeholder, onFocus: register, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value) };
  return multiline ? <textarea rows={3} {...common} /> : <input {...common} />;
}
