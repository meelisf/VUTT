import { useEffect, type MutableRefObject } from 'react';
import { useBlocker } from 'react-router-dom';

/**
 * Blokeerib lehelt lahkumise salvestamata muudatuste korral.
 * Käsitleb nii React Router navigeerimist (useBlocker) kui ka
 * brauseri tab sulgemist / välist navigeerimist (beforeunload).
 *
 * @param isDirty  - kas on salvestamata muudatusi
 * @param skip     - kui ref.current === true, blocker ignoreeritakse (nt pärast salvestamist)
 */
export function useUnsavedChangesGuard(
  isDirty: boolean,
  skip?: MutableRefObject<boolean>,
) {
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !(skip?.current) && isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  return {
    isBlocked: blocker.state === 'blocked',
    blockedLocation: blocker.state === 'blocked' ? blocker.location : null,
    proceed: () => { if (blocker.state === 'blocked') blocker.proceed(); },
    reset: () => { if (blocker.state === 'blocked') blocker.reset(); },
  };
}
