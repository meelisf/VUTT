/**
 * Skaneeringu fade lehe vahetusel.
 *
 * **Invariant: fade on seotud lehenumbri muutusega, MITTE laadimisolekuga.**
 * Kõrvallehtede eellaadimine (`useAdjacentPagePrefetch`) teeb pöörde nii
 * kiireks, et laadimisoleku külge seotud tagasiside vilksatab paar kaadrit ja
 * kaob — täpselt siis, kui eellaadimine töötab. Väga sarnase paigutusega
 * lehtede puhul ei registreeri kasutaja seetõttu, et leht üldse vahetus
 * (change blindness). Seepärast sunnib `dipDone` pildi vähemalt `FADE_OUT_MS`
 * jaoks peitu, sõltumata sellest, kui kiiresti pilt kohal oli.
 */

/** Väljumine: kiire kadu. */
export const FADE_OUT_MS = 90;
/** Sissetulek: rahulikum tagasitulek — leht justkui settib. */
export const FADE_IN_MS = 160;

interface ImageFadeParams {
  /** Uue lehe skaneering pole veel laetud. */
  imageLoading: boolean;
  /** Väljumisfaas on läbi (timer `FADE_OUT_MS` järel). */
  dipDone: boolean;
  /** Kasutaja on OS-is liikumise vähendamise sisse lülitanud. */
  reducedMotion: boolean;
}

/**
 * Pildi läbipaistvus ja ülemineku kestus antud olekus.
 *
 * Pilt tuuakse nähtavale alles siis, kui MÕLEMAD tingimused on täidetud:
 * väljumisfaas on läbi ja pilt on laetud. Sellest järelduvad ülejäänud juhud
 * ilma eraldi loogikata — aeglane pilt jääb lihtsalt tumedaks kuni kohale
 * jõudmiseni ja `ImageViewer`-i olemasolev spinner katab ooteaja.
 */
export function imageFadeStyle({
  imageLoading,
  dipDone,
  reducedMotion,
}: ImageFadeParams): { opacity: 0 | 1; durationMs: number } {
  // Liikumise vähendamine: ei mingit fade'i, pilt vahetub otse. Katab nii
  // vestibulaarsed kui valgustundlikkuse mured (kiirel lappamisel oleks tegu
  // korduva hele–tume välgatusega suurel alal).
  if (reducedMotion) {
    return { opacity: imageLoading ? 0 : 1, durationMs: 0 };
  }

  const visible = !imageLoading && dipDone;
  return { opacity: visible ? 1 : 0, durationMs: visible ? FADE_IN_MS : FADE_OUT_MS };
}
