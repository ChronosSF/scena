// The left panel of a built-in scene: its links, in the order of the plain list. The drawings
// are fixed, so there is nothing to upload, reorder or delete; each row opens the link's form.

import { useMemo } from "react";
import { Eye, EyeOff, Lock, Shapes } from "lucide-react";
import type { ObjectLayer, Slot } from "@scena/scene";
import { store, useStudio } from "../store.ts";
import { canTurnOff, isHidden, slotRows } from "../model.ts";
import { drawingThumb, thumbTheme } from "../thumbs.ts";
import * as actions from "../actions.ts";
import { IconButton } from "./ui.tsx";

function LinkRow({ slot, layer }: { slot: Slot; layer: ObjectLayer }) {
  const { scene, page, sel, rev } = useStudio();
  const link = page.links[slot.id];
  const isSel = layer.id === sel;
  const hidden = isHidden(page, layer);
  const theme = thumbTheme(page);
  const thumb = useMemo(() => drawingThumb(scene, page, layer, `lk-${layer.id}`), [rev, layer.id]); // documents mutate in place
  // what is still to do, at a glance: a link that is on and goes nowhere
  const note = hidden ? "Off" : !link ? "Not set up" : !link.url ? "No address" : "";
  return (
    <li className={`layer${isSel ? " is-sel" : ""}${hidden ? " is-hidden" : ""}`} data-link-row={slot.id}>
      {/* on a phone the form is on the other tab; a row has nothing else to offer, so it goes there */}
      <button type="button" className="layer-main" data-layer-button={layer.id} aria-pressed={isSel} onClick={() => { store.select(layer.id); store.set({ tab: "inspect" }); }}>
        <span className="layer-thumb">{thumb ? <span className="stage thumb-scope" data-theme={theme} dangerouslySetInnerHTML={{ __html: thumb }} /> : <Shapes aria-hidden="true" strokeWidth={1.75} />}</span>
        <span className="layer-name">{slot.label}</span>
        {note ? <span className="layer-note">{note}</span> : null}
      </button>
      {link && canTurnOff(scene, slot) ? (
        <span className="layer-tools">
          <IconButton size="sm" icon={hidden ? EyeOff : Eye} label={hidden ? `Show ${slot.label} on the page` : `Hide ${slot.label} from the page`} onClick={() => actions.toggleHidden(layer.id)} data-ui="visibility" />
        </span>
      ) : null}
    </li>
  );
}

export function LinksPanel(props: { hidden?: boolean; tabbed?: boolean }) {
  const { scene } = useStudio();
  const rows = slotRows(scene);
  return (
    <aside className="panel panel-left" id="panel-layers" aria-label="Links" hidden={props.hidden}
      {...(props.tabbed ? { role: "tabpanel", "aria-labelledby": "tab-layers" } : {})}>
      <div className="panel-head">
        <h2 className="panel-title">Links</h2>
        <span className="layer-badge" style={{ marginRight: 8 }} data-ui="ready-made"><Lock aria-hidden="true" strokeWidth={2} />Ready-made</span>
      </div>
      <p className="links-intro">Choose a drawing, here or on the canvas, and give it your link.</p>
      <div className="layers-head">
        <span className="section-title" id="links-title">In the plain list's order</span>
        <span className="count-badge">{rows.length || ""}</span>
      </div>
      <ol className="layers" aria-labelledby="links-title">
        {rows.map(({ slot, layer }) => <LinkRow key={slot.id} slot={slot} layer={layer} />)}
      </ol>
      <div className="panel-foot">
        The drawings in a ready-made scene stay as they were made. To use your own, choose Start over… in the More menu.
      </div>
    </aside>
  );
}
