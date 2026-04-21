const ESTONIAN_VOWELS = 'aeiouõäöüAEIOUÕÄÖÜ';

export function formatRelationOwnerName(name: string, lang: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed === '…') return name;
  if (lang !== 'et') return name;

  const lastChar = trimmed.charAt(trimmed.length - 1);
  if (ESTONIAN_VOWELS.includes(lastChar)) return name;

  return `${trimmed}'i`;
}

export function formatRelationTypeLabel(
  type: string,
  typeLabels: Record<string, string> | null | undefined,
  lang: string,
): string {
  return typeLabels?.[lang] ?? typeLabels?.en ?? type;
}
