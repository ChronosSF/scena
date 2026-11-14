// The board and the header in the inspector (ADR 0003): a background's settings, the
// typeface (Page), and the hand-lettered name (Page).

import { useMemo } from "react";
import { PenLine, Trash2, Undo2 } from "lucide-react";
import { DEFAULT_TYPEFACE, LETTERING, TYPEFACES, layerAssets, type BackgroundFit, type Layer } from "@scena/scene";
import { useStudio } from "../store.ts";
import * as actions from "../actions.ts";
import { placementOf, type Placement } from "../board.ts";
import { assetSummary } from "../describe.ts";
import { drawingThumb, thumbTheme } from "../thumbs.ts";
import { kb } from "../util.ts";
import { Button, DropButton, IconButton, Section, Segmented, Switch } from "./ui.tsx";

// ------------------------------------------------------------------ a background

export function BackgroundInspector({ layer }: { layer: Layer }) {
  const { scene, page, rev } = useStudio();
  const theme = thumbTheme(page);
  const thumb = useMemo(() => drawingThumb(scene, page, layer, `bgi-${layer.id}`), [rev, layer.id]); // documents mutate in place
  const raster = layerAssets(layer).some((id) => scene.assets[id]?.kind === "raster");
  const dark = layer.assetDark ? scene.assets[layer.assetDark] : undefined;
  const placement = placementOf(scene);
  const meta = assetSummary(scene, layer);

  return (
    <div>
      <div className="insp-head">
        <span className="layer-thumb"><span className="stage thumb-scope" data-theme={theme} dangerouslySetInnerHTML={{ __html: thumb }} /></span>
        <div className="insp-name">
          <p className="insp-title">{layer.name || layer.id}</p>
          <p className="insp-meta" title={meta}>Background · {meta}</p>
        </div>
        <div className="insp-actions">
          <IconButton size="sm" icon={Trash2} label="Delete" className="danger" onClick={() => actions.remove(layer.id)} data-ui="delete" />
        </div>
      </div>

      <Section title="Background">
        <div className="field">
          <span className="field-label">Placement</span>
          <Segmented label="Placement" full value={placement} onChange={(v: Placement) => actions.setBackgroundPlacement(layer.id, v)}
            options={[{ value: "replace", label: "Replace the mat" }, { value: "over", label: "Over the mat" }]} />
        </div>
        <div className="field">
          <span className="field-label">Fit</span>
          <Segmented label="Fit" full value={layer.fit || "cover"} onChange={(v: BackgroundFit) => actions.setBackgroundFit(layer.id, v)}
            options={[{ value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }]} />
        </div>
        <div className="switch-row">
          <span><span className="switch-label">Clip to the mat's shape</span><span className="field-hint">Rounded corners, inside the paper's edge.</span></span>
          <Switch label="Clip to the mat's shape" checked={!!layer.clip} onChange={() => actions.setBackgroundClip(layer.id, !layer.clip)} id="bg-clip" />
        </div>
        <p className="section-note">Backgrounds sit under every drawing. They never boil and take no taps.</p>
      </Section>

      <Section title="Dark mode">
        {dark ? (
          <div className="file-row">
            <span className="file-name">{dark.source || "Dark variant"}<span className="faint"> · {kb(dark.bytes)}</span></span>
            <IconButton size="sm" icon={Trash2} label="Remove the dark variant" className="danger" onClick={() => actions.removeDarkVariant(layer.id)} data-ui="remove-dark" />
          </div>
        ) : (
          <p className="section-note first">
            {raster
              ? "Without a dark variant, the image is printed onto the dark mat (multiplied, at the palette's fill strength), so light paper reads as dark paper."
              : "Painted with the three colours, it recolours with the palette in dark mode too."}
          </p>
        )}
        {layer.asset && !dark ? <DropButton label={`Add a dark variant (${raster ? "PNG or WebP" : "SVG"})`} ui="add-dark" id="dark-file" onFiles={(fs) => void actions.addDarkVariant(layer.id, fs[0]!)} /> : null}
      </Section>

      <Section title="Use as">
        <Button icon={Undo2} onClick={() => actions.useAsDrawing(layer.id)} data-ui="use-drawing">Use as drawing</Button>
      </Section>
    </div>
  );
}

// ------------------------------------------------------------------ the header: typeface and lettering

export function TypefaceSection() {
  const { scene, page } = useStudio();
  const current = scene.theme.font?.family || DEFAULT_TYPEFACE.family;
  const name = page.profile.displayName || "Your Name";
  return (
    <Section title="Typeface">
      <div className="faces" role="radiogroup" aria-label="Typeface">
        {TYPEFACES.map((f) => (
          <label className="face" key={f.family}>
            <input type="radio" name="typeface" value={f.family} checked={current === f.family} onChange={() => actions.setTypeface(f.family)} aria-label={`${f.family}, ${f.note}`} />
            <span className="face-card" aria-hidden="true">
              <span className="face-sample" style={{ fontFamily: `"${f.family}", ${f.fallback}`, fontWeight: f.display, fontSize: `${(1.35 * f.size).toFixed(2)}rem` }}>{name}</span>
              <span className="face-meta">{f.family} · {f.note}</span>
            </span>
          </label>
        ))}
      </div>
      {scene.header?.lettering ? <p className="section-note">Your lettered name shows instead of the typed one; the typeface still sets the bio, the panel and the list.</p> : null}
    </Section>
  );
}

export function LetteringSection() {
  const { scene, page, rev } = useStudio();
  const lt = scene.header?.lettering;
  const asset = lt ? scene.assets[lt.asset] : undefined;
  const theme = thumbTheme(page);
  const preview = useMemo(() => (asset ? drawingThumb(scene, page, { id: "lettering", type: "decor", asset: asset.id }, "ltp") : ""), [rev, asset?.id]); // documents mutate in place
  return (
    <Section title="Name lettering">
      {asset && lt ? (
        <>
          <div className="lettering-preview"><span className="stage thumb-scope" data-theme={theme} dangerouslySetInnerHTML={{ __html: preview }} /></div>
          <div className="file-row">
            <span className="file-name">{asset.source || "Lettering"}<span className="faint"> · {asset.kind === "raster" ? "PNG" : "SVG"} · {kb(asset.bytes)}</span></span>
            <IconButton size="sm" icon={Trash2} label="Remove the lettering" className="danger" onClick={actions.removeLettering} data-ui="remove-lettering" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="lettering-width"><span>Width</span><output className="field-value num" htmlFor="lettering-width">{lt.maxWidth ?? LETTERING.width}%</output></label>
            <div className="range-row">
              <input id="lettering-width" type="range" min={LETTERING.minWidth} max={LETTERING.maxWidth} step={5} value={lt.maxWidth ?? LETTERING.width} onChange={(e) => actions.setLetteringOptions({ maxWidth: Number(e.target.value) })} />
            </div>
          </div>
          <div className="switch-row">
            <span><span className="switch-label">Tilt like the typed name</span><span className="field-hint">The header's slight lean.</span></span>
            <Switch label="Tilt like the typed name" checked={lt.tilt !== false} onChange={() => actions.setLetteringOptions({ tilt: lt.tilt === false })} id="lettering-tilt" />
          </div>
          <p className="section-note">Screen readers and the page title still use the typed name above.</p>
        </>
      ) : (
        <>
          <p className="section-note first">Draw your name and drop it here, as an SVG painted with the three colours (it recolours and gets the riso shadow) or a PNG.</p>
          <DropButton label="Drop a lettered name, or choose a file" ui="add-lettering" id="lettering-file" onFiles={(fs) => void actions.setLetteringFile(fs[0]!)} />
        </>
      )}
    </Section>
  );
}

/** On a drawing: make it the background or the lettered name. */
export function UseAsSection({ layer }: { layer: Layer }) {
  return (
    <Section title="Use as">
      <div className="use-as">
        <Button onClick={() => void actions.useAsBackground(layer.id)} data-ui="use-background">Background</Button>
        <Button icon={PenLine} onClick={() => void actions.useAsLettering(layer.id)} data-ui="use-lettering">Name lettering</Button>
      </div>
      <p className="section-note">A background sits under every drawing and fills the mat; lettering replaces the typed name in the header.</p>
    </Section>
  );
}
