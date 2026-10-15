/**
 * Teoste filtrite mudel (#587): fassettide read, valitud väärtuste lahendus ja
 * keelevahetuse iseparandus. Ühine külgribale (`WorkFilterSections`) ja kiipidele
 * (`WorkFilterChips`) — Dashboard kutsub seda ÜKS kord, et iseparanduse effectid
 * jookseksid ka siis, kui külgriba on kinni (varem elas see `AdvancedFilters`-is).
 */
import { useState, useEffect, useMemo } from 'react';
import { isVuttId } from '../../utils/qcodeUtils';
import { FacetDistribution } from '../../services/searchService';
import { getVocabularies, Vocabularies } from '../../services/collectionService';
import { mergeFacetItems, FilterItem } from '../../utils/facetUtils';
import { resolveFilterValue, resolveItemValue } from '../../utils/filterNormalization';
import type { WorkStatus } from '../../types';

export interface WorkFilterInput {
  selectedGenre: string | null;
  selectedTags: string[];
  selectedType: string | null;
  selectedStatus: WorkStatus | null;
  // Keeled on MITMIKVALIK (erinevalt žanrist/tüübist): teos kannab ADR 0019
  // järgi mitut keelt korraga ja „kreeka VÕI heebrea" on mõttekas päring
  selectedLanguages: string[];
  onGenreChange: (genre: string | null) => void;
  onTagsChange: (tags: string[]) => void;
  onTypeChange: (type: string | null) => void;
  onStatusChange: (status: WorkStatus | null) => void;
  onLanguagesChange: (languages: string[]) => void;
  // Dünaamilised facetid otsingutulemustest (live counts)
  facets?: FacetDistribution;
  // Q-kood → praeguse keele label / label → Q-kood (Wikidata žanrid, märksõnad, tüübid)
  genreIdMap?: Record<string, string>;
  genreLabelToId?: Record<string, string>;
  tagsIdMap?: Record<string, string>;
  tagsLabelToId?: Record<string, string>;
  typeIdMap?: Record<string, string>;
  typeLabelToId?: Record<string, string>;
  lang: 'et' | 'en';
  // Enriched labels cache fallback-ina Q-koodide lahendamiseks
  enrichedLabels?: Record<string, Record<string, string>>;
}

export function useWorkFilterModel(input: WorkFilterInput) {
  const {
    selectedGenre, selectedTags, selectedType, selectedStatus, selectedLanguages,
    onGenreChange, onTagsChange, onTypeChange, onStatusChange, onLanguagesChange,
    facets, genreIdMap, genreLabelToId, tagsIdMap, tagsLabelToId, typeIdMap, typeLabelToId,
    lang, enrichedLabels,
  } = input;

  // Sõnavara state (tõlked)
  const [vocabularies, setVocabularies] = useState<Vocabularies | null>(null);
  const [vocabLoading, setVocabLoading] = useState(true);

  // Kontrolli, kas facetid on laetud (props kaudu)
  const hasFacets = facets && Object.keys(facets).length > 0;
  const loading = vocabLoading || !hasFacets;

  // Lae sõnavara (ainult tõlked, mitte facetid)
  useEffect(() => {
    const loadVocabularies = async () => {
      try {
        const vocabs = await getVocabularies();
        setVocabularies(vocabs);
      } catch (e) {
        console.warn('Sõnavara laadimine ebaõnnestus:', e);
      } finally {
        setVocabLoading(false);
      }
    };
    loadVocabularies();
  }, []);

  // ─────────────────────────────────────────────────────────────────────
  // crossLangTypeMap / crossLangGenreMap — MIKS NEID EI EEMALDATA (issue #18)
  // ─────────────────────────────────────────────────────────────────────
  // Need on label→label keelteülsed tõlketabelid (nt "Jutlus" → "Sermon"):
  // teise keele label → praeguse keele label. Need on `resolveFilterValue`
  // VIIMANE fallback (vt src/utils/filterNormalization.ts) ja aktiveeruvad
  // AINULT siis, kui selectedValue on LABEL (mitte Q-kood) — st vana või
  // jagatud URL ?genre=Jutlus avatakse teises keeles UI-s.
  //
  // Varasem TODO ("eemaldatav kui kõigil teostel type_ids/genre_ids indekseeritud")
  // EI OLE kehtiv — see segas kaks sõltumatut asja:
  //  1. Facetide keeleneutraalsus (genre_ids Q-koodid vs genre_et/genre_en) —
  //     lahendatud juba migratsiooniga 78bb94c. Sellest sõltub facetite
  //     duplikaatide vältimine.
  //  2. CrossLang-map — lahendab label-SISENDI keelt (vanad URL-id). Sellest
  //     EI sõltu andmete terviklus; type_ids/genre_ids terviklus on asjasse
  //     puutumatu eeltingimus. (Tegelikult pole see isegi saavutatav: 16 teosel
  //     on tühi type_ids ja 33-l tühi genre_ids, sest neil puudub tüüp/žanr
  //     lähtemetaandmetes — reindeks ei aita.)
  //
  // Mis juhtuks ilma mapideta (testitud filterNormalization.test.ts järgi):
  //  - Otsingu õigsus: ikka õige — serveri buildGenreFilter("Jutlus") on juba
  //    bilinguaalne OR (genre_et="Jutlus" OR genre_en="Jutlus") (vt filterUtils.ts).
  //  - URL-i normaliseerimine: ikka Q-koodiks — Dashboard write-back genreLabelToId.
  //  - Aktiivfiltri pilli KUVAMINE + facet-listi highlight: väike kosmeetiline
  //    tagasilangus. Praegu töötab highlight crossLangMap-i KAUDU: effectiveSelected*
  //    käivitab self-heal efekti (allpool), mis kirjutab selectedValue ümber praeguse
  //    keele labeliks, ja ALLES SIIS leiab resolveItemValue → labelToId → Q-koodi.
  //    Ilma mapideta jääks self-heal käivitamata → resolveItemValue tagastaks võõr-
  //    labeli korral null (facet-pill ilma highlightita) ja aktiivfiltri pill näitaks
  //    teise keele labelit (nt "Jutlus" inglise UI-s) kuni kasutaja filtrit muudab.
  //    Mõlemad on kosmeetilised; otsingu õigsust ei mõjuta (bilinguaalne OR ülal).
  //
  // Järeldus: mapid ei tee pahavara (testidega kaetud) ja mõjutavad ainult ühte
  // väikest kosmeetilist detaili ühes äärejuhtumis. Eemaldamise vaev + väike
  // regressioon ei kaalu üles. Jätame alles. Kui kõik vanad labelipõhised URL-id
  // kunagi kaovad, saab uuesti hinnata.

  // Keelteülene tõlketabel: teise keele väärtus → praeguse keele väärtus
  const crossLangGenreMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (vocabularies?.genres) {
      const altLang = lang === 'et' ? 'en' : 'et';
      for (const [, labels] of Object.entries(vocabularies.genres)) {
        const altLabel = labels[altLang];
        const curLabel = labels[lang] || labels['et'];
        if (altLabel && curLabel && altLabel !== curLabel) map[altLabel] = curLabel;
      }
    }
    return map;
  }, [lang, vocabularies]);

  const crossLangTypeMap = useMemo(() => {
    const map: Record<string, string> = {};
    if (vocabularies?.types) {
      const altLang = lang === 'et' ? 'en' : 'et';
      for (const [, labels] of Object.entries(vocabularies.types)) {
        const altLabel = labels[altLang];
        const curLabel = labels[lang] || labels['et'];
        if (altLabel && curLabel && altLabel !== curLabel) map[altLabel] = curLabel;
      }
    }
    return map;
  }, [lang, vocabularies]);

  // Ettevalmistatud andmed FilterSection jaoks
  const genreItems = useMemo<FilterItem[]>(() => {
    const genreData = facets?.['genre_ids'];
    if (!genreData) return [];

    const raw = Object.entries(genreData)
      .map(([value, count]) => ({
        value,
        count,
        label: genreIdMap?.[value] || value
      }));
    return mergeFacetItems(raw, genreLabelToId, genreIdMap)
      .sort((a, b) => b.count - a.count);
  }, [facets, genreLabelToId, genreIdMap]);

  const tagItems = useMemo<FilterItem[]>(() => {
    const tagsData = facets?.['tags_ids'];
    if (!tagsData) return [];

    const raw = Object.entries(tagsData)
      .filter(([tag]) => !isVuttId(tag))
      .map(([tag, count]) => ({
        value: tag,
        label: tagsIdMap?.[tag] || tag,
        count
      }));
    // tagsLabelToId: label→Q-kood (grupeering), tagsIdMap: Q-kood→praeguse keele label (kuvamine)
    return mergeFacetItems(raw, tagsLabelToId, tagsIdMap)
      .sort((a, b) => b.count - a.count);
  }, [facets, tagsIdMap, tagsLabelToId]);

  // Keeled: facet-väärtused on ISO 639-3 koodid, sildid tulevad sõnavarast.
  // Q-koodi lahendust ei ole vaja, seega ka mergeFacetItems mitte.
  // Loendur on TEOSEPÕHINE — searchWorks filtreerib `lehekylje_number = 1`.
  const languageItems = useMemo<FilterItem[]>(() => {
    const langData = facets?.['languages'];
    if (!langData) return [];
    return Object.entries(langData)
      .map(([code, count]) => ({
        value: code,
        count,
        label: vocabularies?.languages?.[code]?.[lang] || vocabularies?.languages?.[code]?.et || code
      }))
      .sort((a, b) => b.count - a.count);
  }, [facets, vocabularies, lang]);

  const typeItems = useMemo<FilterItem[]>(() => {
    const typeData = facets?.['type_ids'];
    if (!typeData) return [];

    const raw = Object.entries(typeData)
      .map(([value, count]) => ({
        value,
        count,
        label: typeIdMap?.[value] || value
      }));
    return mergeFacetItems(raw, typeLabelToId, typeIdMap)
      .sort((a, b) => b.count - a.count);
  }, [facets, typeLabelToId, typeIdMap]);

  // Efektiivne valitud väärtus: tõlgi kohe sünkroonselt, et nupp oleks sinine ka enne useEffect'i
  const effectiveSelectedGenre = useMemo(
    () => resolveFilterValue(selectedGenre, genreItems, genreIdMap, crossLangGenreMap),
    [selectedGenre, genreItems, genreIdMap, crossLangGenreMap]
  );

  // item.value formaadis (Q-kood) — FilterSection selectedValues ja onToggle jaoks
  const selectedGenreItemValue = useMemo(
    () => resolveItemValue(selectedGenre, genreItems, genreLabelToId),
    [selectedGenre, genreItems, genreLabelToId]
  );

  const effectiveSelectedType = useMemo(
    () => resolveFilterValue(selectedType, typeItems, typeIdMap, crossLangTypeMap),
    [selectedType, typeItems, typeIdMap, crossLangTypeMap]
  );

  const selectedTypeItemValue = useMemo(
    () => resolveItemValue(selectedType, typeItems, typeLabelToId),
    [selectedType, typeItems, typeLabelToId]
  );

  // Efektiivsed valitud märksõnad: lahenda Q-koodid labeliteks
  const effectiveSelectedTags = useMemo(() => {
    if (selectedTags.length === 0 || !tagsIdMap) return selectedTags;
    const tagValues = new Set(tagItems.map(item => item.value));
    let changed = false;
    const resolved = selectedTags.map(tag => {
      if (tagValues.has(tag)) return tag;
      const mapped = tagsIdMap[tag];
      if (mapped && mapped !== tag) { changed = true; return mapped; }
      return tag;
    });
    return changed ? resolved : selectedTags;
  }, [selectedTags, tagItems, tagsIdMap]);

  // Tõlgi valitud žanr/tüüp/märksõnad praegusesse keelde (uuendab ka URL-i ja parent state'i)
  useEffect(() => {
    if (effectiveSelectedGenre && effectiveSelectedGenre !== selectedGenre) {
      onGenreChange(effectiveSelectedGenre);
    }
  }, [effectiveSelectedGenre, selectedGenre]);

  useEffect(() => {
    if (effectiveSelectedType && effectiveSelectedType !== selectedType) {
      onTypeChange(effectiveSelectedType);
    }
  }, [effectiveSelectedType, selectedType]);

  useEffect(() => {
    if (effectiveSelectedTags !== selectedTags) {
      onTagsChange(effectiveSelectedTags);
    }
  }, [effectiveSelectedTags, selectedTags]);

  // ÜKS rakendaja külgribale ja filtrivihjele (#605): vastuvõetud vihje peab
  // andma täpselt sama oleku kui külgribal valimine. Ainult LISAMISE suund;
  // eemaldamine käib endiselt kiibi × / külgriba uue klikiga.
  const applyWorkFilter = (kind: 'genre' | 'tag' | 'type', value: string) => {
    if (kind === 'genre') onGenreChange(value);
    else if (kind === 'type') onTypeChange(value);
    else if (!effectiveSelectedTags.includes(value)) onTagsChange([...effectiveSelectedTags, value]);
  };

  const toggleTag = (tag: string) => {
    if (effectiveSelectedTags.includes(tag)) {
      onTagsChange(effectiveSelectedTags.filter(t => t !== tag));
    } else {
      applyWorkFilter('tag', tag);
    }
  };

  const languageLabel = (code: string) =>
    vocabularies?.languages?.[code]?.[lang] || vocabularies?.languages?.[code]?.et || code;
  const tagLabel = (tag: string) => {
    // Lahenda Q-kood labeliks: tagsIdMap > enrichedLabels > fallback
    const label = tagsIdMap?.[tag] || enrichedLabels?.[tag]?.[lang] || tag;
    return label ? label[0].toUpperCase() + label.slice(1) : '';
  };

  const activeCount = (selectedGenre ? 1 : 0) + (selectedType ? 1 : 0) + (selectedStatus ? 1 : 0)
    + selectedTags.length + selectedLanguages.length;

  const clearAll = () => {
    onGenreChange(null);
    onTagsChange([]);
    onTypeChange(null);
    onStatusChange(null);
    onLanguagesChange([]);
  };

  return {
    input, loading, activeCount, clearAll, toggleTag, applyWorkFilter,
    genreItems, tagItems, typeItems, languageItems,
    effectiveSelectedGenre, selectedGenreItemValue,
    effectiveSelectedType, selectedTypeItemValue,
    effectiveSelectedTags,
    languageLabel, tagLabel,
  };
}

export type WorkFilterModel = ReturnType<typeof useWorkFilterModel>;
