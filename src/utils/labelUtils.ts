/**
 * Entity labeli lahendamine Q-koodi ja enrichedLabels cache põhjal.
 *
 * Fallback järjekord: UI keel → et → en → la → de → raw Q-kood
 * Põhjus: mõnel Wikidata kirjel puudub eestikeelne tõlge (ainult en/la/de),
 * seega ei tohi fallback lõppeda 'et'-ga.
 */

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const LANG_CHAIN = ['et', 'en', 'la', 'de'] as const;

/** Kanooniline keele-fallback ahel: lang → et → en → la → de → ''. */
export function pickLabelByLang(labels: Record<string, string>, lang: string): string {
    const baseLang = lang.split('-')[0];
    if (labels[baseLang]) return cap(labels[baseLang]);
    for (const l of LANG_CHAIN) {
        if (l !== baseLang && labels[l]) return cap(labels[l]);
    }
    return '';
}

export function resolveEntityLabel(
    qCode: string,
    enrichedLabels: Record<string, Record<string, string>>,
    lang: string,
    fallbackMap?: Record<string, string>
): string {
    const e = enrichedLabels[qCode];
    if (e) {
        return pickLabelByLang(e, lang) || qCode;
    }
    return fallbackMap?.[qCode] || qCode;
}
