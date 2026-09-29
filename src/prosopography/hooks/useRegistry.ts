// src/prosopography/hooks/useRegistry.ts
/** Ameti- või asutuseregister (ADR 0059): üks laadimine lehe kohta, uuesti kirje lisamisel. */
import { useEffect, useState } from 'react';
import { fetchRegistry } from '../services/prosopographyService';
import type { RegistryEntryLike } from '../utils/registryMatch';

type Kind = 'occupation' | 'institution';
const cache: Partial<Record<Kind, Promise<Record<string, RegistryEntryLike>>>> = {};

const CHANGED = 'vutt:registry-changed';

/** Registrisse lisati kirje: vahemälu maha ja kõik selle registri kasutajad laevad uuesti. */
export function registryChanged(kind: Kind): void {
  delete cache[kind];
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: kind }));
}

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
    // Uus kirje isikuvormi aknast: kõik sama registri väljad peavad teda nägema.
    const refresh = (event: Event) => { if ((event as CustomEvent).detail === kind) load(); };
    load();
    window.addEventListener(CHANGED, refresh);
    return () => { alive = false; window.removeEventListener(CHANGED, refresh); };
  }, [kind]);
  return registry;
}
