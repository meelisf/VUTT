// Pildi pööramise geomeetria — peab klappima serveri Pillow rotate(expand=True)-iga.

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Pööratud pildi expand'itud bounding-box (sama valem kui Pillow expand=True). */
export function expandedBoundingBox(w: number, h: number, angleDeg: number): { width: number; height: number } {
  const r = degToRad(angleDeg);
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return {
    width: w * cos + h * sin,
    height: w * sin + h * cos,
  };
}
