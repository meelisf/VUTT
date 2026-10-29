import { describe, it, expect } from 'vitest';
import { parseGitDiff } from '../gitDiff';

const TXT_DIFF = `diff --git a/teos/001.txt b/teos/001.txt
index abc123..def456 100644
--- a/teos/001.txt
+++ b/teos/001.txt
@@ -1,3 +1,3 @@
 esimene rida
-vana rida
+uus rida
\\ No newline at end of file
`;

const JSON_DIFF = `diff --git a/teos/001.json b/teos/001.json
index abc123..def456 100644
--- a/teos/001.json
+++ b/teos/001.json
@@ -1,6 +1,6 @@
 {
-  "updated_at": "2026-01-01",
+  "updated_at": "2026-01-02",
   "status": "Töös",
-  "comments": [],
+  "comments": ["märge"],
 }
`;

const TIMESTAMP_ONLY = `diff --git a/teos/001.json b/teos/001.json
--- a/teos/001.json
+++ b/teos/001.json
@@ -1,3 +1,3 @@
 {
-  "updated_at": "2026-01-01",
+  "updated_at": "2026-01-02",
 }
`;

describe('parseGitDiff', () => {
  it('tühi diff → plokke ei ole', () => {
    expect(parseGitDiff('')).toEqual([]);
  });

  it('tekstifail: päised välja, kontekst ja muudatused alles', () => {
    const blocks = parseGitDiff(TXT_DIFF);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('text');
    expect(blocks[0].lines.map(l => [l.type, l.text])).toEqual([
      ['context', ' esimene rida'],
      ['deletion', '-vana rida'],
      ['addition', '+uus rida'],
    ]);
  });

  it('JSON: tehnilised väljad ja paljad sulud peidetakse', () => {
    const blocks = parseGitDiff(JSON_DIFF);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('json');
    expect(blocks[0].lines.map(l => l.text)).toEqual([
      '   "status": "Töös",',
      '-  "comments": [],',
      '+  "comments": ["märge"],',
    ]);
  });

  it('ainult ajatempli muutus → plokk jäetakse välja', () => {
    expect(parseGitDiff(TIMESTAMP_ONLY)).toEqual([]);
  });

  it('mitu faili → mitu plokki diffi järjekorras', () => {
    const blocks = parseGitDiff(TXT_DIFF + JSON_DIFF);
    expect(blocks.map(b => b.kind)).toEqual(['text', 'json']);
  });

  it('võtmed on diffi piires unikaalsed', () => {
    const keys = parseGitDiff(TXT_DIFF + JSON_DIFF).flatMap(b => b.lines.map(l => l.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
