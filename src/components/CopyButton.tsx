/**
 * Kopeerimisnupp, mis annab 2 s tagasisidet („Kopeeritud" + linnuke).
 * Tõrge (nt lõikelaud keelatud) neelatakse — kood on niikuinii select-all väljas.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface Props {
  text: string;
  label: string;
  copiedLabel: string;
  className?: string;
}

const CopyButton: React.FC<Props> = ({ text, label, copiedLabel, className }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = () => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <button type="button" onClick={copy}
      className={className ?? 'flex shrink-0 items-center gap-1 rounded border px-2 py-0.5 text-xs'}>
      {copied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  );
};

export default CopyButton;
