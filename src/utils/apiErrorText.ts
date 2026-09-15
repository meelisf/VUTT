/**
 * Sessiooni aegumise eristamine muust veast (#318).
 *
 * Backend hoiab sessioone MÄLUS, seega iga juurutus logib kõik välja. Ilma
 * eristuseta näeb väljalogitud kasutaja oma valdkonna veateadet („ligipääsu
 * laadimine ebaõnnestus", „töökollektsioone ei ole") ja otsib viga andmetest,
 * mitte sessioonist. `apiClient` teatab 401-st juba `sessionExpiredHandler`-iga;
 * siin on sama fakt VAATE jaoks.
 */
export function isSessionExpired(e: unknown): boolean {
  return Boolean(e && typeof e === 'object' && (e as { status?: number }).status === 401);
}
