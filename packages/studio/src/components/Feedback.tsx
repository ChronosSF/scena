import { CircleAlert, CircleCheck } from "lucide-react";
import { useUi } from "../ui.ts";

/** The toast is visual only; the live region speaks the same messages. */
export function Feedback() {
  const { toast, live } = useUi();
  const Icon = toast?.kind === "error" ? CircleAlert : CircleCheck;
  return (
    <>
      <div className={`toast${toast ? " show" : ""}${toast?.kind === "error" ? " error" : ""}`} id="toast" aria-hidden="true">
        {toast ? <Icon strokeWidth={1.75} /> : null}
        <span>{toast?.msg}</span>
      </div>
      <div className="sr-only" id="announce" aria-live="polite">{live.msg}</div>
    </>
  );
}
