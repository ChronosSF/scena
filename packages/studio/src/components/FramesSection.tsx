// The inspector's Frames section (ADR 0002): the frames in order, add by upload or drop,
// reorder, remove, speed, when they play, and whether the canvas plays them or holds one
// frame with the others faint behind it (onion skin) to check registration.

import { useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, Film, Plus, Trash2 } from "lucide-react";
import { FRAMES, type FramePlay, type Layer } from "@scena/scene";
import { bboxOf } from "@scena/renderer";
import { store, useStudio } from "../store.ts";
import * as actions from "../actions.ts";
import { PLAY_LABELS, fpsWords, frameRows, frameTiming } from "../frames.ts";
import { drawingThumb } from "../thumbs.ts";
import { IMAGE_ACCEPT as ACCEPT, IconButton, SelectField, Switch, hasFiles } from "./ui.tsx";

export function FramesSection({ layer }: { layer: Layer }) {
  const { scene, page, rev, playFrames, frameAt, framesOpen } = useStudio();
  const rows = frameRows(layer);
  const n = rows.length;
  const timing = frameTiming(layer);
  const clickable = layer.type === "object";
  const theme = page.theme.mode === "auto" ? undefined : page.theme.mode;
  const at = Math.min(frameAt, n - 1);
  const input = useRef<HTMLInputElement>(null);
  const strip = useRef<HTMLOListElement>(null);
  const [over, setOver] = useState(false);
  const titleId = useId(), bodyId = useId(), speedId = useId();
  const thumbs = useMemo(() => rows.map((_, k) => drawingThumb(scene, page, layer, `fth-${layer.id}-${k}`, k)), [rev, layer.id]); // documents mutate in place
  const box = bboxOf(scene.assets[rows[0]![rows[0]!.length - 1]!]);

  const pick = () => input.current?.click();
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); // handled: the window's drop handler leaves it alone
    setOver(false);
    void actions.addFrames(layer.id, [...e.dataTransfer.files]);
  };
  const dropProps = {
    onDragOver: (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop,
  };
  const focusFrame = (k: number) => requestAnimationFrame(() => strip.current?.querySelector<HTMLButtonElement>(`[data-frame="${k}"]`)?.focus());
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Delete" && e.key !== "Backspace" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (e.key === "Delete" || e.key === "Backspace") { actions.removeFrame(layer.id, k); focusFrame(Math.max(0, k - 1)); return; }
    const to = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : Math.max(0, Math.min(n - 1, k + (e.key === "ArrowRight" ? 1 : -1)));
    if (e.altKey) actions.moveFrame(layer.id, k, to); else actions.showFrame(to);
    focusFrame(to);
  };

  const plays = (clickable ? Object.keys(PLAY_LABELS) : ["always"]) as FramePlay[];

  return (
    <section className="section" aria-labelledby={titleId} data-ui="frames" {...dropProps}>
      <div className="section-head">
        <button type="button" className="section-toggle" aria-expanded={framesOpen} aria-controls={bodyId} onClick={() => store.set({ framesOpen: !framesOpen })}>
          <ChevronDown aria-hidden="true" strokeWidth={1.75} />
          <h3 className="section-title" id={titleId}>Frames</h3>
        </button>
        {n > 1 ? <span className="count-badge num" aria-label={`${n} frames`}>{n}</span> : null}
      </div>
      <input ref={input} type="file" id="frame-file" accept={ACCEPT} multiple hidden
        onChange={(e) => { const fs = [...(e.target.files || [])]; e.target.value = ""; if (fs.length) void actions.addFrames(layer.id, fs); }} />
      {framesOpen ? (
        <div id={bodyId}>
          {n < 2 ? (
            <>
              <p className="section-note first">Draw this drawing two to four times with small changes, and add the drawings here. The page flips them like a hand-drawn loop.</p>
              <button type="button" className={`drop frames-drop${over ? " over" : ""}`} onClick={pick} data-ui="add-frames">
                <Film aria-hidden="true" strokeWidth={1.75} /> Add frames: drop or choose files
              </button>
            </>
          ) : (
            <>
              <ol className="frame-strip" ref={strip} aria-label="Frames, in order">
                {rows.map((_, k) => (
                  <li key={k}>
                    <button type="button" className="frame" data-frame={k} aria-pressed={!playFrames && k === at}
                      aria-label={`Frame ${k + 1} of ${n}`} title={`Frame ${k + 1}. Arrows choose, Alt+arrows move, Delete removes.`}
                      tabIndex={k === at ? 0 : -1} onClick={() => actions.showFrame(k)} onKeyDown={(e) => onKey(e, k)}>
                      <span className="stage thumb-scope" data-theme={theme} dangerouslySetInnerHTML={{ __html: thumbs[k] || "" }} />
                      <span className="frame-no num" aria-hidden="true">{k + 1}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" className={`frame frame-add${over ? " over" : ""}`} onClick={pick} aria-label="Add frames" title="Add frames: drop or choose files" data-ui="add-frames">
                    <Plus aria-hidden="true" strokeWidth={1.75} />
                  </button>
                </li>
              </ol>
              <div className="frame-tools">
                <span className="faint num">{playFrames ? "Playing" : `Frame ${at + 1} of ${n}`}</span>
                <span className="spacer" />
                <IconButton size="sm" icon={ArrowLeft} label="Move frame earlier" shortcut="Alt+←" disabled={at === 0} onClick={() => actions.moveFrame(layer.id, at, at - 1)} data-ui="frame-earlier" />
                <IconButton size="sm" icon={ArrowRight} label="Move frame later" shortcut="Alt+→" disabled={at === n - 1} onClick={() => actions.moveFrame(layer.id, at, at + 1)} data-ui="frame-later" />
                <IconButton size="sm" icon={Trash2} label="Remove frame" shortcut="Del" className="danger" onClick={() => actions.removeFrame(layer.id, at)} data-ui="frame-remove" />
              </div>

              <div className="field">
                <label className="field-label" htmlFor={speedId}><span>Speed</span><output className="field-value num" htmlFor={speedId}>{fpsWords(timing.fps)}</output></label>
                <div className="range-row">
                  <input id={speedId} type="range" min={FRAMES.minFps} max={FRAMES.maxFps} step={1} value={timing.fps} name="fps"
                    aria-valuetext={fpsWords(timing.fps)} onChange={(e) => actions.setFrameTiming(layer.id, { fps: Number(e.target.value) })} />
                </div>
              </div>
              <SelectField label="Plays" value={plays.includes(timing.play) ? timing.play : "always"} onChange={(v: FramePlay) => actions.setFrameTiming(layer.id, { play: v })}
                options={plays.map((value) => ({ value, label: PLAY_LABELS[value] }))} />
              {!clickable ? <p className="field-hint frames-hint">On hover, while selected and once on tap need a clickable drawing: turn on Link.</p> : null}
              <div className="switch-row">
                <span>
                  <span className="switch-label">Play on the canvas</span>
                  <span className="field-hint">Off holds one frame, with the others faint behind it, to check that they line up.</span>
                </span>
                <Switch label="Play frames on the canvas" checked={playFrames} onChange={() => actions.showFrame(playFrames ? at : null)} id="play-frames" />
              </div>
              <div className="switch-row">
                <span>
                  <span className="switch-label">Boil the frames too</span>
                  <span className="field-hint">Hand-drawn frames already wobble; the boil redraws on every flip.</span>
                </span>
                <Switch label="Boil the frames too" checked={timing.boil} onChange={() => actions.setFrameTiming(layer.id, { boil: !timing.boil })} id="boil-frames" />
              </div>
              {box ? <p className="section-note">All {n} frames share one box, {Math.round(box.w)} × {Math.round(box.h)}, so they line up.</p> : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}
