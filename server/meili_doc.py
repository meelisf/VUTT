"""
Puhas _metadata.json → Meilisearch dokumendi kaardistusloogika (side-effect-vaba).

See moodul sisaldab AINULT puhast kaardistamist (teksti puhastus, aliase arvutus,
dokumendi ehitamine) — ilma Meili-kliendi, ThreadPoolExecutori, git_opsi või
Muud raske sõltuvuseta. Sõltub ainult stdlibist (re, os) + server.utils +
server.marginalia_normalize.

Eesmärk (issue #23): ühine moodul, mida impordivad MÕLEMAD indekseerimisteega:
  - server/meilisearch_ops.py (live-tee) — otse-import (sama pakett);
  - scripts/1-1_consolidate_data.py (seed/reseed-tee) — fake-package muster
    (juba kasutusel `from server.utils import ...` jaoks).

Nii ei saa kaks teed enam vaikselt lahku minna (varem olid split_marginalia,
clean_text_for_search jms dubleeritud). Divergeerumine on nüüd konstruktsiooni
järgi võimatu.

Väljanimede ORTOGRAAFIA: Meilisearch kasutab vanemat 'y'-ortograafiat
(lehekylje_tekst, teose_lehekylgede_arv jne). Neid EI TOHI ümber nimetada —
otsingufiltrid eeldavad neid (vt issue #16, CLAUDE.md).
"""
import os
import re

from .utils import (
    get_label, get_id, get_all_labels, get_all_ids, get_primary_labels,
    get_labels_by_lang,
)
from .marginalia_normalize import normalize_marginalia_tags


# =========================================================
# TEKSTI PUHASTUS (otsinguindeksi jaoks)
# =========================================================

# <m>...</m> marginaalia plokkide regex. [\s\S]*? → mitmerealune, mitteahne.
M_CONTENT_RE = re.compile(r'<m>([\s\S]*?)</m>')


def split_marginalia(text):
    """Eraldab marginaalia plokid põhitekstist enne indekseerimist.

    Tagastab (põhitekst ilma <m>-plokkideta, marginaaliate sisu reavahetustega liidetult).
    Põhiteksti fraasid jätkuvad üle eemaldatud ploki koha — clean_text_for_search
    liidab poolitused ja kollapsib tühikud ka mitme järjestikuse reavahetuse korral.
    """
    if not text:
        return "", ""
    # Normaliseeri ristuvad/mässitud <m>-tägid (<i><m>X</i></m> → <m><i>X</i></m>)
    # enne eraldamist — muidu jääks orv inline-täg põhiteksti / marginaaliasse.
    text = normalize_marginalia_tags(text)
    notes = M_CONTENT_RE.findall(text)
    # Tühik (mitte tühi string) väldib inline <m> korral ümbritsevate sõnade kokkuliimimist
    # (nt "foo<m>note</m>bar" → "foo bar", mitte "foobar")
    main = M_CONTENT_RE.sub(' ', text)
    return main, "\n".join(notes)


def clean_text_for_search(text):
    """Puhastab teksti otsinguindeksi jaoks, eemaldades vormindusmärgid ja liites poolitused.

    Toetab mõlemat märgendusformaati:
    - Uus XML: <i>, <b>, <cs>, <m>, <hi>, <fn>n</fn>, <pb/>
    - Vana pseudo-markdown: *italic*, **bold*, ~cs~, [[m:text]], --lk--, [^n]
    """
    if not text:
        return ""

    # 1. Uus XML märgendus — eemalda kõik VUTT tägid
    # <fn>n</fn> ja <pb/> asendame tühikuga, ülejäänud tägid eemaldame
    text = re.sub(r'<fn>\d+</fn>', ' ', text)  # joonealuse viite marker
    text = re.sub(r'<pb/>', ' ', text)           # leheküljevahetus
    text = re.sub(r'</?[a-z]+\d*>', '', text)    # avamis/sulgemistägid (<i>, </i>, <cs>, <ann1>, </ann1> jne)

    # 2. Vana pseudo-markdown (legacy, kui faile pole veel migreeritud)
    text = text.replace('*', ' ')               # bold/italic tärnid
    text = text.replace('~', ' ')               # koodivahetus
    text = text.replace('[[m:', ' ').replace(']]', ' ')  # ääremärkus
    text = text.replace('--lk--', ' ')          # leheküljevahetus
    text = re.sub(r'\[\^\d+\]', ' ', text)      # joonealuse viite marker

    # 3. Käitle reavahetuse poolituskriipse PÄRAST tägide eemaldamist
    # (nt "<i>Sueco¬</i>\n<i>rum" -> pärast tägide eemaldust "Sueco¬\nrum" -> "Suecorum")
    text = re.sub(r'[-⸗¬]\s*\n\s*', '', text)

    # 4. Eemalda üleliigsed tühikud
    text = re.sub(r'\s+', ' ', text).strip()

    return text


def _clean_search_text(page_text):
    """Eraldab marginaalia ja puhastab mõlemad osad otsinguindeksi jaoks.

    Võtab toore lehekülje teksti (raw editoritekst) ja tagastab tuple
    (põhitekst_puhastatud, marginaalia_puhastatud), kus:
    - põhitekst = marginaalia `<m>`-plokidest vabastatud ja vormindusmärkidest
      puhastatud (poolitused liidetud, ws kollapseeritud) — otsinguks `lehekylje_tekst`;
    - marginaalia = `<m>`-plokkide sisu samuti puhastatud — otsinguks `marginaalia_tekst`.

    Kombineerib `split_marginalia` (eraldab plokid, sh ristuvad tägiga) ja
    `clean_text_for_search` (eemaldab XML/markdown märgid, liidab poolitused).
    """
    main_text, marginalia_text = split_marginalia(page_text)
    return clean_text_for_search(main_text), clean_text_for_search(marginalia_text)


def build_text_annotations_text(text_annotations):
    """Koostab otsitava teksti text_annotations kommentaaridest.

    Tagastab None kui annotatsioonid puuduvad (väli jäetakse dokumendist välja).
    """
    if not text_annotations:
        return None
    parts = [
        a["comment"]
        for a in text_annotations
        if isinstance(a, dict) and a.get("comment")
    ]
    return " ".join(parts) if parts else None


# =========================================================
# ISIKUTE ALIASED JA NORMALISEERIMINE
# =========================================================

def _invert_name(name: str):
    """Teisendab 'Perenimi, Eesnimi' → 'Eesnimi Perenimi'. Tagastab None kui komat pole."""
    if ',' in name:
        parts = name.split(',', 1)
        return f"{parts[1].strip()} {parts[0].strip()}"
    return None


def compute_autor_respondens(creators):
    """Tuletab teose 'autor' ja 'respondens' kuvaväljad creators-massiivist.

    Autori prioriteet: auctor > praeses > esimene isik (kui esimene EI OLE
    respondens/gratulator/dedicator/editor/aui). Respondens = esimene respondens-roll.
    Tagastab (autor, respondens) tuple (tühjad stringid kui puuduvad).

    NB: hoia loogika ÜHISENA — seda kutsuvad nii live (meilisearch_ops.sync_work)
    kui seed (1-1_consolidate_data) work_ctx ehitamisel (vt issue #23).
    """
    autor = ''
    respondens = ''
    if not creators:
        return autor, respondens
    praeses = next((c for c in creators if c.get('role') == 'praeses'), None)
    auctor = next((c for c in creators if c.get('role') == 'auctor'), None)
    resp = next((c for c in creators if c.get('role') == 'respondens'), None)
    if auctor:
        autor = auctor.get('name', '')
    elif praeses:
        autor = praeses.get('name', '')
    else:
        first_creator = creators[0]
        if first_creator.get('role') not in ['respondens', 'gratulator', 'dedicator', 'editor', 'aui']:
            autor = first_creator.get('name', '')
    if resp:
        respondens = resp.get('name', '')
    return autor, respondens


def get_creator_aliases(creators, people_data):
    """Leiab isikutele aliased (nimevariandid).
    Lisab igale 'Perenimi, Eesnimi' aliasele ka inverteeritud 'Eesnimi Perenimi' versiooni."""
    aliases = []
    for creator in creators:
        creator_id = creator.get('id')
        if creator_id and people_data.get(creator_id):
            person = people_data[creator_id]
            for alias in person.get('aliases', []):
                aliases.append(alias)
                inverted = _invert_name(alias)
                if inverted:
                    aliases.append(inverted)
    return aliases


def normalize_creator(creator, people_data):
    """Normaliseerib isiku nime ja ID people.json kaudu.

    Tagastab (kanooniline_nimi, eelistatud_id) tuple.
    Eelistab Wikidata Q-koodi teiste ID-de üle.
    """
    cid = creator.get('id')
    name = creator.get('name', '')

    if not cid or not people_data or cid not in people_data:
        return name, cid

    person = people_data[cid]
    canonical_name = person.get('primary_name', name)

    # Eelistatavalt Wikidata Q-kood
    ids = person.get('ids', {})
    wikidata_id = ids.get('wikidata')
    if wikidata_id:
        # Veendu et Q-prefiks on olemas
        best_id = wikidata_id if wikidata_id.startswith('Q') else f'Q{wikidata_id}'
    else:
        best_id = cid

    return canonical_name, best_id


def _compute_work_aliases(creators, publisher, tags, people_data):
    """Arvutab work-level aliased ja authors_text ühe teose jaoks.

    Need väärtused sõltuvad AINULT teose metadatast (creators/publisher/tags +
    people register), mitte konkreetsest lehest — seega arvutatakse üks kord
    enne lehtede tsüklit, mitte igal lehel uuesti (vt issue #16 refaktoor).

    Tagastab (aliases, authors_text, publisher_aliases, tag_aliases):
    - aliases: kõikide creatorite nimevariandid (+ invereedid 'Pere, Ees' → 'Ees Pere');
    - authors_text: creatorite nimed + aliased (otsingu jaoks, nt 'Lorenz' → 'Laurentius');
    - publisher_aliases: trükkali nimevariandid;
    - tag_aliases: isiku-märksõnade nimevariandid (nt 'Ludenius' → 'Luden').
    """
    aliases = get_creator_aliases(creators, people_data)
    authors_text = [c['name'] for c in creators if c.get('name')] + aliases

    # Trükkali aliased (trükkalid on ka mitme nimega)
    publisher_aliases = []
    pub_id = get_id(publisher)
    if pub_id and people_data.get(pub_id):
        for alias in people_data[pub_id].get('aliases', []):
            publisher_aliases.append(alias)
            inverted = _invert_name(alias)
            if inverted:
                publisher_aliases.append(inverted)

    # Märksõna aliased (isiku märksõnade nimevariandid)
    tag_aliases = []
    for tag in tags if isinstance(tags, list) else []:
        tag_id = get_id(tag) if isinstance(tag, dict) else None
        if tag_id and people_data.get(tag_id):
            for alias in people_data[tag_id].get('aliases', []):
                tag_aliases.append(alias)
                inverted = _invert_name(alias)
                if inverted:
                    tag_aliases.append(inverted)

    return aliases, authors_text, publisher_aliases, tag_aliases


# =========================================================
# KOLLEKTSIOONIDE HIERARHIA
# =========================================================

def get_collection_hierarchy(collections, collection_ids):
    """Tagastab kollektsioonide hierarhia (kõigi kuuluvate kollektsioonide esivanemate union).

    Args:
        collections: Kõigi kollektsioonide dict (state/collections.json)
        collection_ids: Üks kollektsiooni ID (str) või list ID-sid

    Returns:
        Kõigi kollektsioonide ja nende esivanemate ID-de list (duplikaadid eemaldatud)
    """
    if not collection_ids or not collections:
        return []

    # Normaliseeri listiks
    if isinstance(collection_ids, str):
        ids = [collection_ids]
    else:
        ids = [c for c in collection_ids if c]

    seen = set()
    result = []

    for cid in ids:
        current = cid
        while current:
            if current not in seen:
                seen.add(current)
                result.append(current)
            col = collections.get(current)
            current = col.get('parent') if col else None

    return result


# =========================================================
# LEHE DOKUMENDI EHITAMINE
# =========================================================

def _build_page_document(work_ctx, page_id, page_num, page_text, page_meta, img_name, txt_path):
    """Ehitab ühe lehekülje Meilisearch dokumendi.

    work_ctx sisaldab teose-tasandi konstantseid väärtusi (konstantsed üle kõikide
    lehtede — ehitatud üks kord enne lehtede tsüklit sync_work_to_meilisearch-is).
    Lehe-spetsiifilised sisendid (page_num/page_text/page_meta/img_name/txt_path)
    eraldi, sest need muutuvad lehe kaupa.

    NB: Meilisearchi väljanimesid (vanem 'y'-ortograafia: lehekylje_tekst,
    teose_lehekylgede_arv jne) EI TOHI ümber nimetada — otsingufiltrid eeldavad
    neid (vt issue #16).
    """
    page_tags_data = page_meta.get('tags', [])
    lehekylje_tekst, marginaalia_tekst = _clean_search_text(page_text)

    dir_name = work_ctx['dir_name']
    dir_path = work_ctx['dir_path']
    labels_store = work_ctx['labels_store']
    people_data = work_ctx['people_data']
    creators = work_ctx['creators']
    tags = work_ctx['tags']

    # Normaliseeri tühi location/publisher → None (mitte '').
    # _metadata.json-is võib location/publisher olla tühi string '' — seed-tee
    # get_work_metadata teisendab selle `or`-iga None-iks, live-tee jättis '' alles
    # → *_object väljad lahknesid (issue #23 verifitseerimine leidis 51 teost).
    # Ühtlustame ÜHES kohas → mõlemad teed annavad None. Flat väljad (get_label jms)
    # ei muutu, sest get_label('') == get_label(None) == ''.
    location = work_ctx['location'] or None
    publisher = work_ctx['publisher'] or None

    doc = {
        "id": page_id,
        "work_id": work_ctx['work_id'],  # Nanoid (püsiv lühikood)
        "title": work_ctx['title'],
        "autor": work_ctx['autor'],      # Filtreerimiseks (jääb)
        "respondens": work_ctx['respondens'],  # Filtreerimiseks (jääb)
        "aasta": work_ctx['year'],       # Filtreerimiseks ja sortimiseks (jääb)
        "year": work_ctx['year'],
        "year_display": work_ctx['year_display'],
        "year_start": work_ctx['year_start'],  # Filtreerimiseks (vahemike kattuvus)
        "year_end": work_ctx['year_end'],
        "lehekylje_number": page_num,
        "teose_lehekylgede_arv": work_ctx['teose_lehekylgede_arv'],
        "lehekylje_tekst": lehekylje_tekst,               # OTSING: põhitekst ILMA marginaaliata
        "marginaalia_tekst": marginaalia_tekst,           # OTSING: marginaalia eraldi väljal (alati olemas, ka tühjana — attributesToSearchOn nõuab)
        "text_content": page_text,                             # REDAKTOR: algne tekst koos kõigi märkidega
        "lehekylje_pilt": os.path.join(dir_name, img_name),
        "originaal_kataloog": dir_name,
        "status": page_meta['status'],
        "page_tags": get_primary_labels(page_tags_data),                          # Eesti label, capitalize_first (teose tags-iga ühtlane)
        "page_tags_et": get_labels_by_lang(page_tags_data, 'et', labels_store), # Eesti label, capitalize_first
        "page_tags_en": get_labels_by_lang(page_tags_data, 'en', labels_store), # Inglise label, capitalize_first
        "page_tags_ids": get_all_ids(page_tags_data),              # Q-koodid (filtreeritav, nagu tags_ids)
        "page_tags_suggest_et": [
            f"{(get_labels_by_lang(t, 'et', labels_store) or [''])[0]}|||{t.get('id') or '' if isinstance(t, dict) else ''}"
            for t in page_tags_data
        ],
        "page_tags_suggest_en": [
            f"{(get_labels_by_lang(t, 'en', labels_store) or [''])[0]}|||{t.get('id') or '' if isinstance(t, dict) else ''}"
            for t in page_tags_data
        ],
        "page_tags_object": page_tags_data,
        "has_annotations": bool(page_tags_data or page_meta['comments'] or page_meta['text_annotations']),
        "comments": page_meta['comments'],
        "text_annotations": page_meta['text_annotations'],
        "history": page_meta['history'],
        "last_modified": int(os.path.getmtime(txt_path if os.path.exists(txt_path) else os.path.join(dir_path, img_name)) * 1000),
        "tags": get_primary_labels(tags),
        "tags_et": get_labels_by_lang(tags, 'et', labels_store),
        "tags_en": get_labels_by_lang(tags, 'en', labels_store),
        "tags_object": tags,
        "tags_search": get_all_labels(tags) + work_ctx['tag_aliases'],
        "tags_ids": get_all_ids(tags),
        "collections": work_ctx['work_collections'],
        "collections_hierarchy": work_ctx['collections_hierarchy'],
        "is_public": any(
            work_ctx['collections'].get(c, {}).get("visibility", "public") == "public"
            for c in work_ctx['work_collections']
        ) if work_ctx['work_collections'] else True,
        "shareable": work_ctx['shareable'],
        "location": get_label(location),
        "location_object": location,
        "location_id": get_id(location),
        "location_search": get_all_labels(location),
        "publisher": get_label(publisher),
        "publisher_object": publisher,
        "publisher_id": get_id(publisher),
        "publisher_search": get_all_labels(publisher) + work_ctx['publisher_aliases'],
        "genre": get_label(work_ctx['genre']),
        "genre_et": get_labels_by_lang(work_ctx['genre'], 'et', labels_store),
        "genre_en": get_labels_by_lang(work_ctx['genre'], 'en', labels_store),
        "genre_object": work_ctx['genre'],
        "genre_search": get_all_labels(work_ctx['genre']),
        "genre_ids": get_all_ids(work_ctx['genre']),
        "type": get_label(work_ctx['work_type']),
        "type_et": get_labels_by_lang(work_ctx['work_type'], 'et', labels_store),
        "type_en": get_labels_by_lang(work_ctx['work_type'], 'en', labels_store),
        "type_object": work_ctx['work_type'],
        "type_ids": get_all_ids(work_ctx['work_type']),
        "languages": work_ctx['languages'],
        "creators": creators,
        "authors_text": work_ctx['authors_text'],
        "author_names": list(dict.fromkeys(
            name for c in creators
            if c.get('name') and c.get('role') != 'respondens'
            for name in ([normalize_creator(c, people_data)[0], c['name']] if normalize_creator(c, people_data)[0] != c['name'] else [c['name']])
        )),
        "respondens_names": list(dict.fromkeys(
            name for c in creators
            if c.get('name') and c.get('role') == 'respondens'
            for name in ([normalize_creator(c, people_data)[0], c['name']] if normalize_creator(c, people_data)[0] != c['name'] else [c['name']])
        )),
        "creator_ids": [normalize_creator(c, people_data)[1] for c in creators if c.get('id')]
        # NB: pealkiri, koht, trükkal eemaldatud - kasuta title, location, publisher
    }

    if work_ctx['ester_id']:
        doc['ester_id'] = work_ctx['ester_id']
    if work_ctx['external_url']:
        doc['external_url'] = work_ctx['external_url']

    # Seeria ja relatsioonid (kuvamiseks; frontend loeb hit.series/series_title/relations).
    # .get() — vanad work_ctx-id (nt osatestid) ei pruugi neid sisaldada.
    if work_ctx.get('series'):
        doc['series'] = work_ctx['series']
        doc['series_title'] = work_ctx.get('series_title', '')
    if work_ctx.get('relations'):
        doc['relations'] = work_ctx['relations']

    if work_ctx['archive_refs']:
        doc['archive_refs'] = work_ctx['archive_refs']
        # Denormaliseeritud otsingutekst: kood + arhiivi täisnimi + viide
        parts = []
        for ref in work_ctx['archive_refs']:
            if not isinstance(ref, dict):
                continue
            archive_id = ref.get('archive_id', '')
            if archive_id:
                parts.append(archive_id)
                archive_name = work_ctx['_archives'].get(archive_id, {}).get('name', '')
                if archive_name:
                    parts.append(archive_name)
            if ref.get('reference'):
                parts.append(ref['reference'])
        if parts:
            doc['archive_refs_text'] = ' '.join(parts)

    text_anns = page_meta.get('text_annotations') or []
    ann_text = build_text_annotations_text(text_anns)
    if ann_text is not None:
        doc['text_annotations_text'] = ann_text

    return doc
