// How sample art is painted, for two outputs from one drawing: the scene sample uses the
// renderer's art classes; the fixture files an illustrator would upload use the three
// sentinel colours the studio recolours (#FF00FF ink, #00FFFF colour 1, #FFFF00 colour 2).

export type ArtMode = "classes" | "sentinel";
export type ArtRole = "accent1" | "accent2";

const SENTINEL: Record<ArtRole, string> = { accent1: "#00FFFF", accent2: "#FFFF00" };

/** Ink lines: the `ink` class, or the sentinel ink stroke. */
export const inkAttr = (m: ArtMode, w = 2.4): string =>
  m === "classes" ? `class="ink"${w !== 2.4 ? ` stroke-width="${w}"` : ""}` : `fill="none" stroke="#FF00FF" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

/** A colour fill. */
export const fillAttr = (m: ArtMode, role: ArtRole): string => (m === "classes" ? `class="role-${role}"` : `fill="${SENTINEL[role]}"`);

/** A stroke in a colour. */
export const strokeAttr = (m: ArtMode, role: ArtRole, w: number): string =>
  m === "classes" ? `class="stroke-${role}" fill="none" stroke-width="${w}" stroke-linecap="round"` : `fill="none" stroke="${SENTINEL[role]}" stroke-width="${w}" stroke-linecap="round"`;
