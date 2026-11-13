// The scene picker (development plan, 2.2): one card per ready-made scene. A card is the
// scene itself, not a picture of it: the published page, rendered with the scene's sample
// content into a sandboxed frame, so the lines boil and a tap on a drawing opens its panel
// before anything is chosen. Above the frame the card says who the scene was drawn for and
// what it has room for, in plain words.
//
// The frame is a phone's screen, scaled to the card: the page as a visitor first sees it,
// down to the panel a tap opens, which a frame cut to the card's own shape would hide.
//
// The cards come from a list (BUILT_IN_SCENES in @scena/scenes, through ui.ts). Nothing here
// names a scene, so a new one is a change to that package alone.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { renderPage, resolvePalette } from "@scena/renderer";
import type { BuiltInScene } from "@scena/scenes";
import { useStudio } from "../store.ts";
import { useNarrow, usePrefersDark } from "../hooks.ts";
import { closePicker, useUi } from "../ui.ts";
import { audienceWords, isBuiltIn, slotWords } from "../model.ts";
import * as actions from "../actions.ts";
import { Dialog } from "./Dialog.tsx";
import { Button, IconButton } from "./ui.tsx";

/** The screen the frame shows the page on, in CSS pixels: a small phone. */
const PHONE = { width: 375, height: 667 };

function SceneCard({ entry }: { entry: BuiltInScene }) {
  const id = useId();
  const { scene, sample } = entry;
  // read here, not in the picker: a card exists only while the picker is open
  const { scene: opened, forceMotion } = useStudio();
  const current = isBuiltIn(opened) && opened.id === scene.id;
  // On a narrow screen the cards are one to a row and the list is what scrolls, so the page in
  // the frame does not: a swipe that starts on it moves the list. A tap still reaches it.
  const narrow = useNarrow();
  // the frame keeps the phone's size and is scaled to the card's width, whatever that is
  const view = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const el = view.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / PHONE.width);
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);
  // Until the page paints (its typeface comes over the network first), the frame is the colour of its paper.
  const dark = usePrefersDark();
  const mode = sample.theme.mode === "auto" ? (dark ? "dark" : "light") : sample.theme.mode;
  const paper = resolvePalette(scene, sample)[mode].paper;
  const words = slotWords(scene);
  const audience = audienceWords(scene.audience);
  // The exported page, as in Preview: its links say where they would go instead of leaving.
  const html = useMemo(() => renderPage(scene, sample, { demo: true, forceMotion }).html, [scene, sample, forceMotion]);
  return (
    <li className="scene-card" data-scene={scene.id}>
      <div className="scene-card-head">
        <div className="scene-card-what">
          <h3 className="scene-card-name" id={`${id}-name`}>{scene.name}</h3>
          {audience ? <p className="scene-card-for" data-ui="scene-audience">{audience}</p> : null}
        </div>
        {/* named by its own words and the scene's, so each card's button says which scene it uses */}
        <Button variant="primary" id={`${id}-use`} aria-labelledby={`${id}-use ${id}-name`} onClick={() => void actions.openBuiltIn(scene)} data-ui="scene-use">Use this scene</Button>
      </div>
      <p className="scene-card-slots">
        <span data-ui="scene-count">{scene.slots.length} {scene.slots.length === 1 ? "link" : "links"}</span>: <span data-ui="scene-slots">{words.join(", ")}</span>
        {current ? <span className="layer-badge" data-ui="scene-current">Open now</span> : null}
      </p>
      {/* The choice comes before the frame in the tab order: the frame holds every drawing and link of the page. */}
      <div className="scene-card-view" ref={view} style={{ aspectRatio: `${PHONE.width} / ${PHONE.height}`, background: paper }}>
        <iframe className="scene-card-frame" data-ui="scene-frame" title={`${scene.name}, live, with a sample page`} sandbox="allow-scripts" srcDoc={html}
          scrolling={narrow ? "no" : undefined} style={{ width: PHONE.width, height: PHONE.height, transform: `scale(${scale})` }} />
      </div>
      <p className="scene-card-note">Live, with {sample.profile.displayName}’s page as a sample. Tap a drawing to try it.</p>
    </li>
  );
}

export function ScenePicker() {
  const { picker } = useUi();
  const heading = useRef<HTMLHeadingElement>(null);
  const open = !!picker;
  // The browser would put the focus on the first button, and that button chooses a scene: a
  // key held a moment too long on the way in would choose it. The heading takes the focus.
  // (This effect runs after the Dialog's, which is what shows the dialog.)
  useEffect(() => { if (open) heading.current?.focus(); }, [open]);
  const scenes = picker?.scenes || [];
  return (
    <Dialog open={open} onClose={closePicker} labelledBy="picker-h" className="picker" style={{ "--cards": Math.min(scenes.length || 1, 3) } as CSSProperties}>
      {picker ? (
        <>
          <div className="picker-head">
            <div>
              <h2 className="dlg-title" id="picker-h" tabIndex={-1} ref={heading}>Choose a scene</h2>
              <p className="dlg-text">Each one is already drawn: you fill in the links, the words and the colours.</p>
            </div>
            <IconButton icon={X} label="Close" tip={false} onClick={closePicker} data-ui="picker-close" />
          </div>
          <ul className="scene-cards" aria-label="Ready-made scenes" data-ui="scene-cards">
            {scenes.map((entry) => (
              <SceneCard key={entry.scene.id} entry={entry} />
            ))}
          </ul>
        </>
      ) : null}
    </Dialog>
  );
}
