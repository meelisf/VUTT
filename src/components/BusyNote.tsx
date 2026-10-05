import React from 'react';
import { Loader2 } from 'lucide-react';

/**
 * „Töö käib" märk ühe pika päringu ajaks, mille edenemist ei saa mõõta
 * (nt ettepaneku kinnitus: registri- ja kaardikirjutus + git-commitid).
 * Loendatava töö jaoks on `ProgressBar`.
 */
const BusyNote: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <p role="status" aria-live="polite" className={`flex items-center gap-2 text-sm text-gray-700 ${className}`}>
    <Loader2 size={16} className="shrink-0 animate-spin text-primary-600" aria-hidden="true" />
    <span>{children}</span>
  </p>
);

export default BusyNote;
