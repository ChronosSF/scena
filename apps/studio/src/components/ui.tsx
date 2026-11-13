// Studio UI primitives. Radix supplies focus management, keyboard behaviour and
// positioning for tooltips, menus and popovers; everything is styled with the --ui-*
// tokens in studio.css (docs/design/studio-ui.md).

import { useEffect, useId, useRef, useState, type ChangeEvent, type ComponentProps, type DragEvent, type ReactNode } from "react";
import * as RTooltip from "@radix-ui/react-tooltip";
import * as RMenu from "@radix-ui/react-dropdown-menu";
import * as RPopover from "@radix-ui/react-popover";
import { ChevronDown, CircleAlert, ImageUp, TriangleAlert, type LucideIcon } from "lucide-react";

export const TooltipProvider = RTooltip.Provider;

/** A tooltip for an existing focusable element. */
export function Tip({ label, shortcut, children, side = "bottom" }: { label: ReactNode; shortcut?: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RTooltip.Root>
      {/* On focus a tooltip is for the keyboard. Focus handed back by a script, to a button the pointer has left, opens none. */}
      <RTooltip.Trigger asChild onFocus={(e) => { if (!e.currentTarget.matches(":focus-visible")) e.preventDefault(); }}>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="tooltip" side={side} sideOffset={6} collisionPadding={8}>
          {label}{shortcut ? <kbd>{shortcut}</kbd> : null}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

type IconButtonProps = Omit<ComponentProps<"button">, "children"> & { icon: LucideIcon; label: string; shortcut?: string; size?: "sm"; tip?: boolean; tipSide?: "top" | "bottom" | "left" | "right" };

/** An icon-only button: always labelled for assistive tech, with a tooltip for sighted users. */
export function IconButton({ icon: Icon, label, shortcut, size, tip = true, tipSide, className = "", ...rest }: IconButtonProps) {
  const button = (
    <button type="button" aria-label={label} className={`icon-btn${size ? ` ${size}` : ""} ${className}`.trim()} {...rest}>
      <Icon aria-hidden="true" strokeWidth={1.75} />
    </button>
  );
  return tip ? <Tip label={label} shortcut={shortcut} side={tipSide}>{button}</Tip> : button;
}

export function Button({ icon: Icon, variant, children, className = "", ...rest }: ComponentProps<"button"> & { icon?: LucideIcon; variant?: "primary" | "ghost" | "danger" }) {
  return (
    <button type="button" className={`btn${variant ? ` btn-${variant}` : ""} ${className}`.trim()} {...rest}>
      {Icon ? <Icon aria-hidden="true" strokeWidth={1.75} /> : null}
      {children}
    </button>
  );
}

/** A segmented control built from native radios (arrow keys move between options). */
export function Segmented<T extends string>(props: {
  label: string; value: T; onChange: (v: T) => void; full?: boolean; iconOnly?: boolean;
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
}) {
  const name = useId();
  return (
    <div className={`seg${props.full ? " full" : ""}${props.iconOnly ? " icon-only" : ""}`} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => {
        const Icon = o.icon;
        const item = (
          <label className="seg-item" key={o.value}>
            <input type="radio" name={name} value={o.value} checked={o.value === props.value} onChange={() => props.onChange(o.value)} aria-label={props.iconOnly ? o.label : undefined} />
            <span>{Icon ? <Icon aria-hidden="true" strokeWidth={1.75} /> : null}{props.iconOnly ? null : o.label}</span>
          </label>
        );
        return props.iconOnly ? <Tip key={o.value} label={o.label}>{item}</Tip> : item;
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }: { checked: boolean; onChange: () => void; label: string; id?: string }) {
  return (
    <span className="switch">
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={onChange} aria-label={label} />
      <span className="switch-track" aria-hidden="true" />
    </span>
  );
}

export function Section({ title, action, children, id }: { title: string; action?: ReactNode; children?: ReactNode; id?: string }) {
  const hid = useId();
  return (
    <section className="section" aria-labelledby={hid} id={id}>
      <div className="section-head">
        <h3 className="section-title" id={hid}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface Check { level: "error" | "warn" | ""; text: string }

export function TextField(props: {
  label: string; value: string; onChange: (v: string) => void; max?: number; multiline?: boolean;
  placeholder?: string; hint?: string; type?: "text" | "url"; inputMode?: "text" | "url"; check?: (v: string) => Check | null;
  name?: string;
}) {
  const id = useId();
  const { label, value, onChange, max, multiline, placeholder, hint, type = "text", inputMode, check } = props;
  const result = check ? check(value) : null;
  const describedBy = [hint && `${id}-h`, `${id}-m`].filter(Boolean).join(" ");
  const common = {
    id, value, placeholder, maxLength: max, autoComplete: "off", name: props.name,
    "aria-describedby": describedBy, "aria-invalid": result?.level === "error" ? true : undefined,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
  };
  const Icon = result?.level === "error" ? CircleAlert : result?.level === "warn" ? TriangleAlert : null;
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        <span>{label}</span>
        {max ? <span className={`count${value.length > max * 0.85 ? " near" : ""}`} aria-hidden="true">{value.length}/{max}</span> : null}
      </label>
      {multiline ? <textarea className="textarea" rows={3} {...common} /> : <input className="input" type={type} inputMode={inputMode} {...common} />}
      {hint ? <p className="field-hint" id={`${id}-h`}>{hint}</p> : null}
      <p className={`field-msg ${result?.level || ""}`} id={`${id}-m`} aria-live="polite">
        {Icon ? <Icon aria-hidden="true" strokeWidth={1.75} /> : null}{result?.text || ""}
      </p>
    </div>
  );
}

export function SelectField<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: readonly { value: T; label: string }[] }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <span className="select-wrap">
        <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown aria-hidden="true" strokeWidth={1.75} />
      </span>
    </div>
  );
}

/**
 * A compact numeric field. The prefix scrubs the value when dragged sideways; typing
 * commits on Enter or blur, so "1" on the way to "120" does not move anything.
 */
export function NumberField(props: { label: string; prefix: ReactNode; value: number; onCommit: (v: number) => void; step?: number; suffix?: string; min?: number; max?: number; name?: string }) {
  const id = useId();
  const [draft, setDraft] = useState(String(props.value));
  const [editing, setEditing] = useState(false);
  const scrub = useRef<{ x: number; v: number; id: number } | null>(null);
  useEffect(() => { if (!editing) setDraft(String(props.value)); }, [props.value, editing]);
  const clamp = (v: number) => Math.min(props.max ?? Infinity, Math.max(props.min ?? -Infinity, v));
  const commit = () => {
    setEditing(false);
    const v = parseFloat(draft);
    if (Number.isFinite(v) && clamp(v) !== props.value) props.onCommit(clamp(v));
    else setDraft(String(props.value));
  };
  return (
    <div className="num-field">
      <span className="num-prefix" aria-hidden="true" title={`Drag to change ${props.label.toLowerCase()}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub.current = { x: e.clientX, v: props.value, id: e.pointerId }; }}
        onPointerMove={(e) => {
          const s = scrub.current;
          if (!s || s.id !== e.pointerId) return;
          const step = props.step ?? 1;
          const next = clamp(Math.round((s.v + Math.round((e.clientX - s.x) / 2) * step) * 10) / 10);
          if (next !== props.value) props.onCommit(next);
        }}
        onPointerUp={() => { scrub.current = null; }} onPointerCancel={() => { scrub.current = null; }}>
        {props.prefix}
      </span>
      <input id={id} type="number" name={props.name} aria-label={props.label} step={props.step ?? 1} inputMode="decimal" value={draft}
        onFocus={() => setEditing(true)} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).blur(); } }} />
      {props.suffix ? <span className="num-suffix" aria-hidden="true">{props.suffix}</span> : null}
    </div>
  );
}

// Menus and popovers: thin wrappers so every surface looks and animates the same.
export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;
export function MenuContent({ children, align = "start" }: { children: ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <RMenu.Portal>
      <RMenu.Content className="menu" align={align} sideOffset={6} collisionPadding={8}>{children}</RMenu.Content>
    </RMenu.Portal>
  );
}
// A dialog opened from a menu is modal before the menu has handed the focus back to its
// button, and the item that had the focus is gone when the dialog closes: the browser has
// nowhere to return it. So a chosen item notes its menu's button, and the dialog that opens
// next takes the note (Dialog.tsx) and returns the focus there when it closes.
let menuButton: { el: HTMLElement; at: number } | null = null;
/** The button of the menu an item was chosen from a moment ago, once. */
export function takeMenuButton(): HTMLElement | null {
  const noted = menuButton;
  menuButton = null;
  return noted && performance.now() - noted.at < 500 ? noted.el : null;
}

export function MenuItem({ icon: Icon, children, onSelect, danger, meta, ...rest }: { icon?: LucideIcon; children: ReactNode; onSelect: () => void; danger?: boolean; meta?: ReactNode; disabled?: boolean } & Record<`data-${string}`, string>) {
  const select = (e: Event) => {
    const menu = (e.target as Element | null)?.closest?.('[role="menu"]');
    const button = menu ? document.getElementById(menu.getAttribute("aria-labelledby") || "") : null;
    menuButton = button ? { el: button, at: performance.now() } : null;
    onSelect();
  };
  return (
    <RMenu.Item className={`menu-item${danger ? " danger" : ""}`} onSelect={select} {...rest}>
      {Icon ? <Icon aria-hidden="true" strokeWidth={1.75} /> : null}
      <span className="menu-text">{children}</span>
      {meta ? <span className="menu-meta">{meta}</span> : null}
    </RMenu.Item>
  );
}
export const MenuSeparator = () => <RMenu.Separator className="menu-sep" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <RMenu.Label className="menu-label">{children}</RMenu.Label>;

export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export function PopoverContent({ children, align = "end", label }: { children: ReactNode; align?: "start" | "end" | "center"; label: string }) {
  return (
    <RPopover.Portal>
      <RPopover.Content className="popover" align={align} sideOffset={8} collisionPadding={8} aria-label={label}>{children}</RPopover.Content>
    </RPopover.Portal>
  );
}

// ------------------------------------------------------------------ files

/** The drawings the studio accepts, for every file input. */
export const IMAGE_ACCEPT = ".svg,.png,.webp,image/svg+xml,image/png,image/webp";

/** Whether a drag carries files (React or native event). */
export const hasFiles = (e: { dataTransfer: DataTransfer | null }): boolean => !!e.dataTransfer?.types?.includes("Files");

/**
 * One file-drop behaviour for every drop target: spread `dropProps` on the element that takes
 * the drop, render `<input {...inputProps} />` once, and call `pick()` to open the chooser.
 * `over` is true while files are dragged across the target.
 */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const dropProps = {
    onDragOver: (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); },
  };
  const inputProps = {
    ref: input, type: "file" as const, accept: IMAGE_ACCEPT, hidden: true,
    onChange: (e: ChangeEvent<HTMLInputElement>) => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) onFiles(fs); },
  };
  return { over, pick: () => input.current?.click(), dropProps, inputProps };
}

/** A button that opens the file chooser and is also a drop target. */
export function DropButton({ label, onFiles, ui, id, multiple = false, icon: Icon = ImageUp, className = "" }:
  { label: ReactNode; onFiles: (fs: File[]) => void; ui: string; id: string; multiple?: boolean; icon?: LucideIcon; className?: string }) {
  const d = useFileDrop(onFiles);
  return (
    <>
      <button type="button" className={`drop${className ? ` ${className}` : ""}${d.over ? " over" : ""}`} data-ui={ui} onClick={d.pick} {...d.dropProps}>
        <Icon aria-hidden="true" strokeWidth={1.75} /> {label}
      </button>
      <input id={id} multiple={multiple} {...d.inputProps} />
    </>
  );
}
