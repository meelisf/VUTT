/**
 * Kirjutamisulatuse algväärtus taotluse kinnitamisel (#321).
 *
 * Taotleja märgib registreerimisvormil, millised kogud teda huvitavad. See on
 * **soov, mitte volitus** (ADR 0031): ulatuse otsustab admin. Soov ainult
 * eeltäidab valiku, et admin ei peaks seda vabatekstist tuletama.
 *
 * Eraldi funktsioon, sest siin on üks kergesti kaduv vahe: admini TEADLIK
 * tühi valik peab võitma taotleja soovi. `||` teeks tühjast massiivist
 * tõeväärtusliku „ei ole valitud" ja tooks soovi tagasi — vaikselt.
 */
export function resolveApproveScope(
  explicit: string[] | undefined,
  interest: string[] | undefined,
): string[] {
  if (explicit !== undefined) return explicit;
  return interest ?? [];
}
