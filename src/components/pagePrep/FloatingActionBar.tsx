import React from 'react';

interface Props {
  /** Kaardi lisaklassid (nt `overflow-hidden` või sisu paigutus). */
  className?: string;
  children: React.ReactNode;
}

/**
 * Hõljuva alumise tegevusriba karkass. Üks kest kõigile hulgitegevuste
 * ribadele (teose haldus, upload'i ülevaatus, töölaud) — ekraanid peavad
 * välja nägema nagu üks süsteem (#431).
 *
 * z-[1100] on TEADLIKULT päise (`sticky z-[1200]`) all.
 */
const FloatingActionBar: React.FC<Props> = ({ className = '', children }) => (
  <div className="fixed bottom-0 left-0 right-0 z-[1100] flex justify-center px-3 pb-3 pointer-events-none">
    <div className={`pointer-events-auto w-full max-w-4xl rounded-xl border border-gray-200 bg-white shadow-lg ${className}`}>
      {children}
    </div>
  </div>
);

export default FloatingActionBar;
