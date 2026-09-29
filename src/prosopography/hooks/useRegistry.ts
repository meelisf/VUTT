// src/prosopography/hooks/useRegistry.ts
/** Ameti- või asutuseregister (ADR 0059): üks laadimine lehe kohta, uuesti akna fookusel. */
import { useEffect, useState } from 'react';
import { fetchRegistry } from '../services/prosopographyService';
import type { RegistryEntryLike } from '../utils/registryMatch';

type Kind = 'occupation' | 'institution';
const cache: Partial<Record<Kind, Promise<Record<string, RegistryEntryLike>>>> = {};

/** Tühi objekt laadimise ajal või vea korral: väli töötab siis nagu enne registrit. */
export function useRegistry(kind: Kind): Record<string, RegistryEntryLike> {
  const [registry, setRegistry] = useState<Record<string, RegistryEntryLike>>({});
  useEffect(() => {
    let alive = true;
    const load = () => {
      const p = cache[kind] ??= (fetchRegistry(kind) as Promise<Record<string, RegistryEntryLike>>)
        .catch(err => { delete cache[kind]; throw err; });
      p.then(r => { if (alive) setRegistry(r); }).catch(() => {});
    };
    // Isikuvormi „Loo registrikirje" avab registrilehe uues vaates; tagasi tulles
    // peab uus kirje vormi jõudma, muidu „Seo" nuppu ei tule.
    const refresh = () => { delete cache[kind]; load(); };
    load();
    window.addEventListener('focus', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); };
  }, [kind]);
  return registry;
}
