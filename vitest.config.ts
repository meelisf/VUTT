import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Vaikimisi `node`: valdav osa testidest on puhas loogika ja jsdom-i
    // püstipanek iga faili kohta maksaks aega ilma kasuta. Komponenditest
    // valib keskkonna ise failipäises:
    //   /** @vitest-environment jsdom */
    environment: 'node',
    // `.tsx` on nimekirjas, et komponenditestid üldse leitaks.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Vaikimisi võtaks vitest töölise peaaegu iga tuuma kohta (arendusmasinas
    // 16), igaüks eraldi Node'i protsess. 13 GB RAM-iga masinas viis see koos
    // brauseriga mälusurveni ja OOM tappis Firefoxi (2026-11-13/14).
    maxWorkers: 4,
  },
});
