// Lohistatava paneeli asukoha piiramine (MetadataModal, osade paneel #464).
// Paneeli võib lükata osaliselt külje taha, et alt lehte näha, aga päise haarderiba
// peab jääma kättesaadavaks — muidu ei saa teda enam tagasi tuua.

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }

/** Mitu pikslit päisest peab horisontaalselt ekraanile jääma. */
export const GRIP_VISIBLE = 120;
/** Päise kõrgus, mis peab alt nähtavale jääma. */
export const HEADER_VISIBLE = 44;

export function clampPosition(pos: Point, size: Size, view: Size): Point {
  const x = Math.min(Math.max(pos.x, GRIP_VISIBLE - size.w), view.w - GRIP_VISIBLE);
  const y = Math.min(Math.max(pos.y, 0), view.h - HEADER_VISIBLE);
  return { x, y };
}

/** Vaikimisi asukoht: paremas servas, päise all; kitsal ekraanil vasakust servast. */
export function defaultPanelPosition(size: Size, view: Size): Point {
  return { x: Math.max(16, view.w - size.w - 24), y: 80 };
}
