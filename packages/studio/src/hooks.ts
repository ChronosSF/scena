import { useEffect, useState } from "react";

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}

/** True when the OS uses a dark appearance. */
export const usePrefersDark = (): boolean => useMedia("(prefers-color-scheme: dark)");

/** True below the narrow-layout breakpoint (single column, panels as tabs). */
export const useNarrow = (): boolean => useMedia("(max-width: 899.98px)");

/** True when the OS asks for reduced motion. */
export const useReducedMotion = (): boolean => useMedia("(prefers-reduced-motion: reduce)");

export function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

/** A value that follows `value` after it has been still for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
