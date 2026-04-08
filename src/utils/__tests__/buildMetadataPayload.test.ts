import { describe, it, expect } from 'vitest';
import { cleanEsterId, cleanTags, cleanCreators, buildMetadataPayload, cleanArchiveRefs } from '../buildMetadataPayload';
import type { MetadataFormData } from '../buildMetadataPayload';
import type { ArchiveRef } from '../../types';
import type { LinkedEntity } from '../../types/LinkedEntity';

// ---------------------------------------------------------------------------
// cleanEsterId
// ---------------------------------------------------------------------------
describe('cleanEsterId', () => {
  it('ekstraktib ESTER URL-ist b-numbri', () => {
    expect(cleanEsterId('https://www.ester.ee/record=b1234567')).toBe('b1234567');
  });

  it('tagastab juba puhta ID muutmata', () => {
    expect(cleanEsterId('b1234567')).toBe('b1234567');
  });

  it('trimmib whitespace', () => {
    expect(cleanEsterId('  b1234567  ')).toBe('b1234567');
  });

  it('tühi string → null', () => {
    expect(cleanEsterId('')).toBeNull();
  });

  it('ainult whitespace → null', () => {
    expect(cleanEsterId('   ')).toBeNull();
  });

  it('URL ilma record= prefixita → tagastab URL täielikult (ei filtreeri)', () => {
    // Kasutaja sisestab suvalise URL-i — ei muuda, läheb serverisse valideerimisele
    expect(cleanEsterId('https://example.com/b1234567')).toBe('https://example.com/b1234567');
  });
});

// ---------------------------------------------------------------------------
// cleanTags
// ---------------------------------------------------------------------------
describe('cleanTags', () => {
  const entity = (label: string): LinkedEntity => ({
    id: 'Q1', label, source: 'wikidata',
  });

  it('eemaldab tühjad stringid', () => {
    expect(cleanTags(['', '  ', 'keemia'])).toEqual(['keemia']);
  });

  it('trimmib whitespace stringidelt', () => {
    expect(cleanTags(['  teoloogia  '])).toEqual(['teoloogia']);
  });

  it('LinkedEntity objektid läbivad puutumata', () => {
    const e = entity('keemia');
    expect(cleanTags([e])).toEqual([e]);
  });

  it('filtreerib välja LinkedEntity objekti kui label on tühi', () => {
    expect(cleanTags([{ id: 'Q1', label: '', source: 'wikidata' }])).toEqual([]);
  });

  it('segamini stringid ja entiteedid — mõlemad käsitletud õigesti', () => {
    const e = entity('Tartu');
    const result = cleanTags(['', e, '  filosoofia  ', { id: null, label: '', source: 'manual' }]);
    expect(result).toEqual([e, 'filosoofia']);
  });

  it('tühi massiiv → tühi tulemus', () => {
    expect(cleanTags([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cleanCreators
// ---------------------------------------------------------------------------
describe('cleanCreators', () => {
  it('eemaldab tühjanimega kirje', () => {
    expect(cleanCreators([{ name: '', role: 'auctor' }])).toEqual([]);
  });

  it('eemaldab ainult whitespace nimega kirje', () => {
    expect(cleanCreators([{ name: '   ', role: 'praeses' }])).toEqual([]);
  });

  it('trimmib nime whitespace', () => {
    const result = cleanCreators([{ name: '  Johann Forselius  ', role: 'auctor' }]);
    expect(result[0].name).toBe('Johann Forselius');
  });

  it('säilitab rolli, id ja source', () => {
    const result = cleanCreators([{
      name: 'Johann Forselius',
      role: 'praeses',
      id: 'Q12345',
      source: 'wikidata',
    }]);
    expect(result[0]).toEqual({
      name: 'Johann Forselius',
      role: 'praeses',
      id: 'Q12345',
      source: 'wikidata',
    });
  });

  it('säilitab id=null (sidumata isik)', () => {
    const result = cleanCreators([{ name: 'Tundmatu', role: 'respondens', id: null }]);
    expect(result[0].id).toBeNull();
  });

  it('mitu kirjet — ainult tühjad eemaldatakse', () => {
    const result = cleanCreators([
      { name: 'Johann', role: 'praeses' },
      { name: '', role: 'respondens' },
      { name: 'Georg', role: 'auctor' },
    ]);
    expect(result).toHaveLength(2);
    expect(result.map(c => c.name)).toEqual(['Johann', 'Georg']);
  });
});

// ---------------------------------------------------------------------------
// buildMetadataPayload
// ---------------------------------------------------------------------------

const baseForm = (): MetadataFormData => ({
  title: 'Testpealkiri',
  year: 1680,
  year_display: '',
  type: null,
  genre: [],
  tags: [],
  location: '',
  publisher: '',
  creators: [],
  languages: [],
  ester_id: '',
  external_url: '',
  collections: [],
  archive_refs: [],
});

describe('buildMetadataPayload', () => {
  it('sisaldab work_id', () => {
    const payload = buildMetadataPayload(baseForm(), 'abc123');
    expect(payload.work_id).toBe('abc123');
  });

  it('tühi year_display → null', () => {
    expect(buildMetadataPayload(baseForm(), 'x').metadata.year_display).toBeNull();
  });

  it('year_display whitespace → null', () => {
    const form = { ...baseForm(), year_display: '   ' };
    expect(buildMetadataPayload(form, 'x').metadata.year_display).toBeNull();
  });

  it('year_display väärtusega → trimitud string', () => {
    const form = { ...baseForm(), year_display: '  ca. 1680  ' };
    expect(buildMetadataPayload(form, 'x').metadata.year_display).toBe('ca. 1680');
  });

  it('tühi genre massiiv → null', () => {
    expect(buildMetadataPayload(baseForm(), 'x').metadata.genre).toBeNull();
  });

  it('mitteTühi genre massiiv → säilitatakse', () => {
    const e: LinkedEntity = { id: 'Q861911', label: 'oratsioon', source: 'wikidata' };
    const form = { ...baseForm(), genre: [e] };
    expect(buildMetadataPayload(form, 'x').metadata.genre).toEqual([e]);
  });

  it('tühi languages massiiv → null', () => {
    expect(buildMetadataPayload(baseForm(), 'x').metadata.languages).toBeNull();
  });

  it('mitteTühi languages → säilitatakse', () => {
    const form = { ...baseForm(), languages: ['la', 'de'] };
    expect(buildMetadataPayload(form, 'x').metadata.languages).toEqual(['la', 'de']);
  });

  it('tühi external_url → null', () => {
    expect(buildMetadataPayload(baseForm(), 'x').metadata.external_url).toBeNull();
  });

  it('tühi ester_id → null', () => {
    expect(buildMetadataPayload(baseForm(), 'x').metadata.ester_id).toBeNull();
  });

  it('ESTER URL → ekstraktib b-numbri', () => {
    const form = { ...baseForm(), ester_id: 'https://www.ester.ee/record=b1234567' };
    expect(buildMetadataPayload(form, 'x').metadata.ester_id).toBe('b1234567');
  });

  it('originaalKataloog olemas → original_path payload-is', () => {
    const payload = buildMetadataPayload(baseForm(), 'x', 'some/path/file.pdf');
    expect(payload.original_path).toBe('some/path/file.pdf');
  });

  it('originaalKataloog puudub → original_path puudub', () => {
    const payload = buildMetadataPayload(baseForm(), 'x');
    expect(payload).not.toHaveProperty('original_path');
  });

  it('originaalKataloog null → original_path puudub', () => {
    const payload = buildMetadataPayload(baseForm(), 'x', null);
    expect(payload).not.toHaveProperty('original_path');
  });

  it('creators puhastamine toimub payload-is', () => {
    const form = {
      ...baseForm(),
      creators: [
        { name: '  Johann  ', role: 'praeses' as const },
        { name: '', role: 'respondens' as const },
      ],
    };
    const { creators } = buildMetadataPayload(form, 'x').metadata;
    expect(creators).toHaveLength(1);
    expect(creators[0].name).toBe('Johann');
  });

  it('tags puhastamine toimub payload-is', () => {
    const form = { ...baseForm(), tags: ['', '  teoloogia  ', ''] };
    const { tags } = buildMetadataPayload(form, 'x').metadata;
    expect(tags).toEqual(['teoloogia']);
  });

  it('type null → null', () => {
    expect(buildMetadataPayload(baseForm(), 'x').metadata.type).toBeNull();
  });

  it('type LinkedEntity → säilitatakse', () => {
    const e: LinkedEntity = { id: 'Q1261026', label: 'väitekiri', source: 'wikidata' };
    const form = { ...baseForm(), type: e };
    expect(buildMetadataPayload(form, 'x').metadata.type).toEqual(e);
  });
});

// ---------------------------------------------------------------------------
// cleanArchiveRefs
// ---------------------------------------------------------------------------
describe('cleanArchiveRefs', () => {
  it('tühi massiiv → null', () => {
    expect(cleanArchiveRefs([])).toBeNull();
  });

  it('kirje archive_id ja reference-ga → säilitatakse', () => {
    const refs: ArchiveRef[] = [{ archive_id: 'EAA', reference: '1.2.3, l. 4' }];
    expect(cleanArchiveRefs(refs)).toEqual([{ archive_id: 'EAA', reference: '1.2.3, l. 4' }]);
  });

  it('url olemas → jääb alles', () => {
    const refs: ArchiveRef[] = [{ archive_id: 'EAA', reference: '1.2.3', url: 'https://example.com' }];
    expect(cleanArchiveRefs(refs)).toEqual([{ archive_id: 'EAA', reference: '1.2.3', url: 'https://example.com' }]);
  });

  it('tühi url → jäetakse välja', () => {
    const refs: ArchiveRef[] = [{ archive_id: 'EAA', reference: '1.2.3', url: '   ' }];
    const result = cleanArchiveRefs(refs);
    expect(result).toEqual([{ archive_id: 'EAA', reference: '1.2.3' }]);
    expect(result![0]).not.toHaveProperty('url');
  });

  it('trimmib archive_id, reference ja url whitespace', () => {
    const refs: ArchiveRef[] = [{ archive_id: '  EAA  ', reference: '  1.2.3  ', url: '  https://example.com  ' }];
    expect(cleanArchiveRefs(refs)).toEqual([{ archive_id: 'EAA', reference: '1.2.3', url: 'https://example.com' }]);
  });

  it('kirje ilma archive_id ja reference-ta → filtreeritakse välja', () => {
    const refs: ArchiveRef[] = [
      { archive_id: '', reference: '' },
      { archive_id: 'EAA', reference: '1.2.3' },
    ];
    expect(cleanArchiveRefs(refs)).toEqual([{ archive_id: 'EAA', reference: '1.2.3' }]);
  });

  it('ainult tühjad kirjed → null', () => {
    const refs: ArchiveRef[] = [{ archive_id: '', reference: '' }];
    expect(cleanArchiveRefs(refs)).toBeNull();
  });

  it('mitu kirjet → kõik säilitatakse', () => {
    const refs: ArchiveRef[] = [
      { archive_id: 'EAA', reference: '1.2.3' },
      { archive_id: 'TÜR', reference: 'Ms. 123' },
    ];
    expect(cleanArchiveRefs(refs)).toEqual(refs);
  });
});

// ---------------------------------------------------------------------------
// buildMetadataPayload — archive_refs
// ---------------------------------------------------------------------------
describe('buildMetadataPayload — archive_refs', () => {
  it('tühi archive_refs massiiv → null payload-is', () => {
    expect(buildMetadataPayload(baseForm(), 'x').metadata.archive_refs).toBeNull();
  });

  it('archive_refs kirjetega → säilitatakse', () => {
    const refs: ArchiveRef[] = [{ archive_id: 'EAA', reference: '1.2.3, l. 4', url: 'https://example.com' }];
    const form = { ...baseForm(), archive_refs: refs };
    expect(buildMetadataPayload(form, 'x').metadata.archive_refs).toEqual(refs);
  });

  it('kirje ilma url-ita → säilitatakse (url puudub)', () => {
    const refs: ArchiveRef[] = [{ archive_id: 'TÜR', reference: 'Ms. 123' }];
    const form = { ...baseForm(), archive_refs: refs };
    expect(buildMetadataPayload(form, 'x').metadata.archive_refs).toEqual([{ archive_id: 'TÜR', reference: 'Ms. 123' }]);
  });

  it('filtreerib tühjad kirjed ja trimmib', () => {
    const refs: ArchiveRef[] = [
      { archive_id: '', reference: '' },
      { archive_id: '  EAA  ', reference: '  1.2.3  ' },
    ];
    const form = { ...baseForm(), archive_refs: refs };
    expect(buildMetadataPayload(form, 'x').metadata.archive_refs).toEqual([{ archive_id: 'EAA', reference: '1.2.3' }]);
  });
});
