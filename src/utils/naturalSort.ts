// Kanooniline loomulik-sort, peab langema kokku Python natural_sort_key-ga
// (NFC + lower + numbri/teksti-plokid, numbrid arvuna; viik → originaalnimi).

type Token = [number, number, string];   // (tüüp, arv, tekst): tekst=(0,..) num=(1,..)

function tokenize(name: string): Token[] {
  const norm = name.normalize('NFC').toLowerCase();
  // re.split(r'(\d+)') ekvivalent: paaris=tekst (sh tühjad), paaritu=number
  const parts = norm.split(/(\d+)/);
  return parts.map((tok, i): Token =>
    i % 2 === 1 ? [1, parseInt(tok, 10), ''] : [0, 0, tok]
  );
}

export function naturalSortKey(name: string): { tokens: Token[]; original: string } {
  return { tokens: tokenize(name), original: name };
}

export function naturalCompare(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const len = Math.min(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const [t1, n1, s1] = ta[i];
    const [t2, n2, s2] = tb[i];
    if (t1 !== t2) return t1 - t2;          // tekst (0) enne numbrit (1)
    if (t1 === 1) { if (n1 !== n2) return n1 - n2; }
    else { if (s1 !== s2) return s1 < s2 ? -1 : 1; }
  }
  if (ta.length !== tb.length) return ta.length - tb.length;
  return a < b ? -1 : a > b ? 1 : 0;        // viigi-katkestaja: originaalnimi
}
