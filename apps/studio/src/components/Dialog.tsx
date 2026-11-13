import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { takeMenuButton } from "./ui.tsx";

/** A native modal <dialog>: focus trapping, Escape and the backdrop come from the browser. */
export function Dialog(props: { open: boolean; onClose: () => void; labelledBy: string; className?: string; style?: CSSProperties; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // The browser returns the focus to what had it when the dialog opened. A dialog opened from
  // a menu is the exception (ui.tsx, takeMenuButton): there the menu's button gets it.
  const menuButton = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) { menuButton.current = takeMenuButton(); d.showModal(); }
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog ref={ref} className={props.className} style={props.style} aria-labelledby={props.labelledBy}
      onClose={() => { if (menuButton.current?.isConnected) menuButton.current.focus(); menuButton.current = null; props.onClose(); }}
      onClick={(e) => { if (e.target === ref.current) props.onClose(); }}>
      {props.children}
    </dialog>
  );
}
