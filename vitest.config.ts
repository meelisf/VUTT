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
  },
});
