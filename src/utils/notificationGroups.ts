import type { NotificationRecipient } from '../services/notificationService';

/**
 * Saajate rollirühmad teavituse saatmise vormis.
 *
 * Rühm on VALIKU kiirtee, mitte omaette saatmisrežiim: rühma klõps lisab
 * (või eemaldab) kõik selle rolliga kasutajad tavalisse valikusse, kust saab
 * üksikuid veel maha võtta. Server saab endiselt `multiple` režiimi
 * kasutajanimede loendiga — uut õigust ega serveriloogikat ei teki.
 */
export type RecipientGroup = 'admins' | 'editors' | 'contributors';

export const RECIPIENT_GROUPS: RecipientGroup[] = ['admins', 'editors', 'contributors'];

// Superadmin kuulub administraatorite hulka — eraldi rühmaks on neid liiga vähe.
const GROUP_ROLES: Record<RecipientGroup, string[]> = {
  admins: ['admin', 'superadmin'],
  editors: ['editor'],
  contributors: ['contributor'],
};

export const groupUsernames = (recipients: NotificationRecipient[], group: RecipientGroup): string[] =>
  recipients.filter(r => GROUP_ROLES[group].includes(r.role)).map(r => r.username);

/** Rühm on valitud, kui tal on liikmeid ja KÕIK nad on valikus. */
export const isGroupSelected = (
  recipients: NotificationRecipient[],
  group: RecipientGroup,
  selected: Set<string>,
): boolean => {
  const members = groupUsernames(recipients, group);
  return members.length > 0 && members.every(u => selected.has(u));
};

/** Täielikult valitud rühm eemaldatakse, muidu lisatakse puuduolevad liikmed. */
export const toggleGroup = (
  recipients: NotificationRecipient[],
  group: RecipientGroup,
  selected: Set<string>,
): Set<string> => {
  const members = groupUsernames(recipients, group);
  const next = new Set(selected);
  if (isGroupSelected(recipients, group, selected)) members.forEach(u => next.delete(u));
  else members.forEach(u => next.add(u));
  return next;
};

/** Pikk saajate loend lühendatakse: „Mari, Jüri, Anne +12". */
export const shortenNames = (names: string[], max = 5): string => {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
};
