/**
 * Serveri ajatempel → Date.
 *
 * Backend jookseb Dockeris UTC-s ja paljud teed kirjutavad `datetime.now().isoformat()`
 * ilma ajavööndita. Brauser loeb sellise stringi KOHALIKU ajana → nihe 2–3 h.
 * Ajavööndita ISO-kuupäev-kellaaeg tõlgendatakse seepärast UTC-na; nihkega
 * (`Z`, `+00:00`) või ainult kuupäevaga string jääb puutumata.
 */
export function parseServerDate(value: string): Date {
  const naive = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value);
  return new Date(naive ? `${value}Z` : value);
}

/**
 * Kuupäev + kellaaeg eesti kujul.
 *
 * Eraldi utiliit, sest sama vorming on nüüd kolmes vaates (kasutajate loend,
 * kasutaja detail, registreerimistaotlused) ja koopiad lahknevad vaikselt.
 */
export function formatDateTime(isoString: string): string {
  return parseServerDate(isoString).toLocaleDateString('et-EE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
