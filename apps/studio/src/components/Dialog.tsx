import { useEffect, useRef, type ReactNode } from "react";

/** A native modal <dialog>: focus trapping, Escape and the backdrop come from the browser. */
export function Dialog(props: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (props.open && !d.open) d.showModal();
    if (!props.open && d.open) d.close();
  }, [props.open]);
  return (
    <dialog ref={ref} aria-labelledby={props.labelledBy} onClose={props.onClose}
      onClick={(e) => { if (e.target === ref.current) props.onClose(); }}>
      {props.children}
    </dialog>
  );
}
