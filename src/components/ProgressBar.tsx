import React from 'react';

interface Props {
  /** 0–100; väljaspool vahemikku klambitakse. */
  percent: number;
  /** Vasak silt riba kohal (nt „42 %"). */
  label?: React.ReactNode;
  /** Parem silt riba kohal (nt „12 / 65 lehte"). */
  detail?: React.ReactNode;
  /** Riba värvi klass (vaikimisi primary, nagu upload'is). */
  barClassName?: string;
}

/**
 * Edenemisriba. Üks kuju upload'i ülekandele ja teose halduse lehetoimingutele
 * (#431) — varem oli sama märgendus `UploadStepTransfer`-is kolm korda.
 */
const ProgressBar: React.FC<Props> = ({ percent, label, detail, barClassName = 'bg-primary-600' }) => {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div>
      {(label || detail) && (
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{label}</span>
          <span>{detail}</span>
        </div>
      )}
      <div
        className="w-full bg-gray-200 rounded-full h-2"
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)}
      >
        <div className={`${barClassName} h-2 rounded-full transition-all duration-300`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
};

export default ProgressBar;
