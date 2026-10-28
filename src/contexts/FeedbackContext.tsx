import React, { createContext, useCallback, useContext, useMemo, useRef, useState, ReactNode } from 'react';
import ConfirmModal from '../components/ConfirmModal';
import { ErrorBanner, type BannerVariant } from '../components/ErrorBanner';

/**
 * Kasutajale tagasiside ÜKS muster (#672): kinnitus = `useConfirm`, teade = `useNotify`.
 *
 * Natiivne `alert`/`confirm` blokeeris, ei olnud stiilitud ja nupud olid
 * brauseri keeles; brauseriautomaatika jäi dialoogi taha kinni. Valvur:
 * `src/__tests__/noNativeDialogs.test.ts`. Salvestamata muudatuste dialoog
 * on eraldi (`UnsavedChangesDialog`).
 */

export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'warning' | 'danger';
}

type Confirm = (options: ConfirmOptions | string) => Promise<boolean>;
type Notify = (message: string, variant?: BannerVariant) => void;

interface Notice { id: number; message: string; variant: BannerVariant }

// Edu kaob ise; viga ja hoiatus jäävad, kuni kasutaja sulgeb (nagu alert).
const SUCCESS_TIMEOUT_MS = 6000;
const MAX_NOTICES = 3;

const FeedbackContext = createContext<{ confirm: Confirm; notify: Notify } | null>(null);

export const FeedbackProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(0);

  const confirm = useCallback<Confirm>((options) => new Promise<boolean>(resolve => {
    const opts = typeof options === 'string' ? { message: options } : options;
    // Uus küsimus vana peale: vana vastus on „ei" — ükski ootaja ei jää rippuma.
    setPending(prev => { prev?.resolve(false); return { ...opts, resolve }; });
  }), []);

  const close = useCallback((ok: boolean) => {
    setPending(prev => { prev?.resolve(ok); return null; });
  }, []);

  const dismiss = useCallback((id: number) => setNotices(prev => prev.filter(n => n.id !== id)), []);

  const notify = useCallback<Notify>((message, variant = 'error') => {
    const id = ++nextId.current;
    setNotices(prev => [...prev, { id, message, variant }].slice(-MAX_NOTICES));
    if (variant === 'success') setTimeout(() => dismiss(id), SUCCESS_TIMEOUT_MS);
  }, [dismiss]);

  const value = useMemo(() => ({ confirm, notify }), [confirm, notify]);

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <ConfirmModal
        isOpen={pending !== null}
        title={pending?.title}
        message={pending?.message ?? ''}
        confirmText={pending?.confirmText}
        cancelText={pending?.cancelText}
        variant={pending?.variant}
        onConfirm={() => close(true)}
        onCancel={() => close(false)}
      />
      {notices.length > 0 && (
        // Kõige peal (z-[1400] nagu ConfirmModal): teade võib tulla modaali seest.
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:w-96 z-[1400] flex flex-col gap-2" role="status">
          {notices.map(n => (
            <ErrorBanner key={n.id} message={n.message} variant={n.variant}
              onClose={() => dismiss(n.id)} className="shadow-lg" />
          ))}
        </div>
      )}
    </FeedbackContext.Provider>
  );
};

function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error('useConfirm/useNotify peab olema FeedbackProvider-i sees');
  return ctx;
}

/** `if (!(await askConfirm(t('…')))) return;` — natiivse `confirm()` asendus. */
export const useConfirm = (): Confirm => useFeedback().confirm;

/** Mitteblokeeriv teade (vaikimisi viga) — natiivse `alert()` asendus. */
export const useNotify = (): Notify => useFeedback().notify;
