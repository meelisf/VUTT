/**
 * Kuupäev + kellaaeg eesti kujul.
 *
 * Eraldi utiliit, sest sama vorming on nüüd kolmes vaates (kasutajate loend,
 * kasutaja detail, registreerimistaotlused) ja koopiad lahknevad vaikselt.
 */
export function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleDateString('et-EE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
