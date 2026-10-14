/**
 * Isikute filtrite külgriba sisu (#587). Peegeldab teoste `WorkFilterSections`-it:
 * `CollapsibleSection` + `SearchableFilterList`, nähtaval viis sagedasemat.
 * Järjekord: Aasta → Päritolu → Haridusasutus → Märksõnad → Seisus → Sugu → Allikas.
 *
 * Kõik filtrid on üksikvalikud (URL-is üks väärtus): uus valik asendab vana,
 * valitu uus klikk eemaldab. `origin_place` tuleb kaardilt ja on ainult kiip.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, CalendarDays, Crown, Database, MapPin, Tag, Venus } from 'lucide-react';
import CollapsibleSection from '../../components/CollapsibleSection';
import SearchableFilterList from '../../components/filters/SearchableFilterList';

export type GenderFilter = '' | 'M' | 'F';

const VISIBLE = 5;

export interface PersonFacetItem {
  value: string;
  label: string;
  count: number;
}

interface PersonFilterSectionsProps {
  yearFrom: string;
  yearTo: string;
  originGroup: string;
  institution: string;
  tag: string;
  statusId: string;
  gender: GenderFilter;
  source: string;
  originGroups: PersonFacetItem[];
  institutions: PersonFacetItem[];
  tagFacets: PersonFacetItem[];
  seisused: { id: string; label: { et: string; en: string } }[];
  onYearFromChange: (v: string) => void;
  onYearToChange: (v: string) => void;
  onOriginGroupChange: (v: string) => void;
  onInstitutionChange: (v: string) => void;
  onTagChange: (v: string) => void;
  onStatusIdChange: (v: string) => void;
  onGenderChange: (v: GenderFilter) => void;
  onSourceChange: (v: string) => void;
}

/** Fassetita valikute rida (seisus, sugu, allikas) — sama kuju mis loendil. */
const OptionList: React.FC<{
  options: { value: string; label: string }[];
  selected: string;
  onToggle: (value: string) => void;
}> = ({ options, selected, onToggle }) => (
  <div className="space-y-1">
    {options.map(({ value, label }) => {
      const isSelected = selected === value;
      return (
        <label key={value} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(isSelected ? '' : value)}
            className="text-primary-600 focus:ring-primary-500 rounded"
          />
          <span className={`text-sm flex-1 truncate ${isSelected ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>
            {label}
          </span>
        </label>
      );
    })}
  </div>
);

const yearInput = (value: string, onChange: (v: string) => void, placeholder: string, label: string) => (
  <input
    type="text"
    inputMode="numeric"
    value={value}
    aria-label={label}
    onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
    placeholder={placeholder}
    className="w-20 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 bg-gray-50/50"
  />
);

const PersonFilterSections: React.FC<PersonFilterSectionsProps> = ({
  yearFrom, yearTo, originGroup, institution, tag, statusId, gender, source,
  originGroups, institutions, tagFacets, seisused,
  onYearFromChange, onYearToChange, onOriginGroupChange, onInstitutionChange,
  onTagChange, onStatusIdChange, onGenderChange, onSourceChange,
}) => {
  const { t, i18n } = useTranslation('prosopography');
  const isEn = !!i18n.language?.startsWith('en');
  const single = (current: string, set: (v: string) => void) => (val: string) => set(current === val ? '' : val);

  return (
    <div className="space-y-1">
      <CollapsibleSection
        title={t('filterYearRange', 'Aastavahemik')}
        icon={<CalendarDays size={14} />}
        defaultOpen
        badge={yearFrom || yearTo ? 1 : undefined}
      >
        <div className="flex items-center gap-2 pb-1">
          {yearInput(yearFrom, onYearFromChange, '1632', t('filterYearFrom', 'Alates'))}
          <span className="text-xs text-gray-400">–</span>
          {yearInput(yearTo, onYearToChange, '1710', t('filterYearTo', 'Kuni'))}
        </div>
      </CollapsibleSection>

      {originGroups.length > 0 && (
        <CollapsibleSection
          title={t('originGroup', 'Päritolu')}
          icon={<MapPin size={14} />}
          defaultOpen
          badge={originGroup ? 1 : undefined}
        >
          <SearchableFilterList
            items={originGroups}
            selectedValues={originGroup ? [originGroup] : []}
            onToggle={single(originGroup, onOriginGroupChange)}
            placeholder={t('filterOriginSearch', 'Otsi piirkonda…')}
            collapsedCount={VISIBLE}
          />
        </CollapsibleSection>
      )}

      {institutions.length > 0 && (
        <CollapsibleSection
          title={t('filterInstitutionAll', 'Haridusasutus')}
          icon={<BookOpen size={14} />}
          defaultOpen={!!institution}
          badge={institution ? 1 : undefined}
        >
          <SearchableFilterList
            items={institutions}
            selectedValues={institution ? [institution] : []}
            onToggle={single(institution, onInstitutionChange)}
            placeholder={t('filterInstitutionSearch', 'Otsi asutust…')}
            collapsedCount={VISIBLE}
          />
        </CollapsibleSection>
      )}

      {tagFacets.length > 0 && (
        <CollapsibleSection
          title={t('filterTags')}
          icon={<Tag size={14} />}
          defaultOpen={!!tag}
          badge={tag ? 1 : undefined}
        >
          <SearchableFilterList
            items={tagFacets}
            selectedValues={tag ? [tag] : []}
            onToggle={single(tag, onTagChange)}
            placeholder={t('filterTagsSearch')}
            collapsedCount={VISIBLE}
          />
        </CollapsibleSection>
      )}

      {seisused.length > 0 && (
        <CollapsibleSection
          title={t('filterStatus', 'Seisus')}
          icon={<Crown size={14} />}
          defaultOpen={!!statusId}
          badge={statusId ? 1 : undefined}
        >
          <OptionList
            options={seisused.map(s => ({ value: s.id, label: isEn ? s.label.en : s.label.et }))}
            selected={statusId}
            onToggle={onStatusIdChange}
          />
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title={t('filterGenderAll', 'Sugu')}
        icon={<Venus size={14} />}
        defaultOpen={!!gender}
        badge={gender ? 1 : undefined}
      >
        <OptionList
          options={[
            { value: 'M', label: t('filterMale', 'Meessoost') },
            { value: 'F', label: t('filterFemale', 'Naissoost') },
          ]}
          selected={gender}
          onToggle={v => onGenderChange(v as GenderFilter)}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title={t('filterSourceAll', 'Allikas')}
        icon={<Database size={14} />}
        defaultOpen={!!source}
        badge={source ? 1 : undefined}
      >
        <OptionList
          options={[{ value: 'aa', label: t('filterSourceAA', 'Album Academicum') }]}
          selected={source}
          onToggle={onSourceChange}
        />
      </CollapsibleSection>
    </div>
  );
};

export default PersonFilterSections;
