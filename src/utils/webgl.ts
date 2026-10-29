// MapLibre vajab WebGL2-te. Ilma selleta (vana masin, kaugtöölaud, välja
// lülitatud graafikakiirendus) viskab ta konstruktoris ja kaart kukub veapiiri.
let cached: boolean | null = null;

export function supportsWebGL2(): boolean {
  if (cached !== null) return cached;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    cached = !!gl;
    // Proovikontekst vabaks — brauser lubab korraga piiratud arvu WebGL-kontekste.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cached = false;
  }
  return cached;
}
