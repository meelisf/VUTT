// src/prosopography/hooks/useRegistry.ts
/** Ameti- või asutuseregister (ADR 0059), laetakse üks kord lehe kohta. */
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
    const p = cache[kind] ??= (fetchRegistry(kind) as Promise<Record<string, RegistryEntryLike>>)
      .catch(err => { delete cache[kind]; throw err; });
    p.then(r => { if (alive) setRegistry(r); }).catch(() => {});
    return () => { alive = false; };
  }, [kind]);
  return registry;
}
