// Teose isikurollide valik sõnavarast; sõnavara laadimata → kolm põhirolli.
import type { TFunction } from 'i18next';
import type { Vocabularies } from '../../services/collectionService';
import type { RoleOption } from './CreatorsEditor';

export function vocabularyRoleOptions(vocabularies: Vocabularies | null, lang: 'et' | 'en', t: TFunction): RoleOption[] {
  if (!vocabularies) {
    return ['praeses', 'respondens', 'auctor'].map(id => ({ id, label: t(`workspace:metadata.roles.${id}`) }));
  }
  return Object.entries(vocabularies.roles).map(([id, d]) => ({ id, label: d[lang] || d.et }));
}
