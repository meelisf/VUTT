/**
 * Liidendatud (tombstone) kaardi marsruut peab jõudma päris kirjeni (#240).
 *
 * Backend vastab tombstone'ile 301-ga elava kaardi peale, `fetch` järgib selle
 * vaikselt ja tagastab järglase andmed. Ilma marsruudi parandamiseta jääks
 * aadressiribale surnud ID ja lehel oleks teise isiku sisu — täpselt see
 * segadus, mille pärast tombstone peab viitama päris kirjele.
 */
export function mergedRedirectTarget(
  routeId: string,
  loadedId: string | undefined | null,
): string | null {
  if (!loadedId) return null;
  let route = routeId;
  try {
    route = decodeURIComponent(routeId);
  } catch {
    // vigane %-jada — võrdleme toorel kujul
  }
  return route === loadedId ? null : loadedId;
}
