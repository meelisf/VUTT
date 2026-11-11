/** Liiklusgraafiku puhtad abilised (#786) — eraldi failis, et katta ühiktestiga. */

export interface TrafficMinute {
  minute: string;
  total: number;
  anon: number;
  errors: number;
  slow: number;
  ips: number;
}

export interface TrafficBin {
  start: string;
  total: number;
  anon: number;
  errors: number;
  slow: number;
  /** Suurim minuti IP-arv kastis — IP-sid üle minutite liita ei saa (sama IP kordub). */
  maxIps: number;
}

/** Koondab minutiread `size`-minutilisteks kastideks; viimane kast võib olla poolik. */
export function binMinutes(minutes: TrafficMinute[], size: number): TrafficBin[] {
  const bins: TrafficBin[] = [];
  for (let i = 0; i < minutes.length; i += size) {
    const chunk = minutes.slice(i, i + size);
    bins.push({
      start: chunk[0].minute,
      total: chunk.reduce((s, m) => s + m.total, 0),
      anon: chunk.reduce((s, m) => s + m.anon, 0),
      errors: chunk.reduce((s, m) => s + m.errors, 0),
      slow: chunk.reduce((s, m) => s + m.slow, 0),
      maxIps: Math.max(...chunk.map(m => m.ips)),
    });
  }
  return bins;
}

/** Viimased `n` TÄIS minutit (jooksev, pooleli minut jääb välja) — sama aken mis häirel. */
export function lastWindow(minutes: TrafficMinute[], n: number) {
  const window = minutes.slice(0, -1).slice(-n);
  const total = window.reduce((s, m) => s + m.total, 0);
  const anon = window.reduce((s, m) => s + m.anon, 0);
  return {
    rps: window.length ? total / (window.length * 60) : 0,
    anonShare: total ? anon / total : 0,
    maxIps: window.length ? Math.max(...window.map(m => m.ips)) : 0,
    errors: window.reduce((s, m) => s + m.errors, 0),
  };
}
