/**
 * Entity labeli lahendamine Q-koodi ja enrichedLabels cache põhjal.
 *
 * Fallback järjekord: UI keel → et → en → la → de → raw Q-kood
 * Põhjus: mõnel Wikidata kirjel puudub eestikeelne tõlge (ainult en/la/de),
 * seega ei tohi fallback lõppeda 'et'-ga.
 */

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function resolveEntityLabel(
    qCode: string,
    enrichedLabels: Record<string, Record<string, string>>,
    lang: string,
    fallbackMap?: Record<string, string>
): string {
    const e = enrichedLabels[qCode];
    if (e) {
        return cap(e[lang] || e.et || e.en || e.la || e.de || qCode);
    }
    return fallbackMap?.[qCode] || qCode;
}
