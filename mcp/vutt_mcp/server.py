"""MCP-tööriistade registreerimine. Hoia õhuke: loogika elab teistes moodulites.

KÕIK tööriistad on @mcp.tool(structured_output=False) — SDK v2 tuletaks muidu
-> str tagastusest ka structured_content'i, mille tugi on klientide vahel
ebaühtlane (Codex CLI, Gemini CLI, Antigravity).

Tööriistade kirjeldused on tahtlikult iseseletavad: mudel, kes VUTT-ist midagi
ei tea, peab kirjeldusest aru saama, mis on work_id ja mida „Toores" tähendab.
"""
from mcp.server.mcpserver import MCPServer

from . import format as fmt
from . import persons
from . import queries
from .client import VuttClient
from .config import load_settings
from .errors import VuttError, VuttNotFound
from .instructions import SERVER_INSTRUCTIONS

MAX_PAGE_SPAN = 20


def build_server(client=None, base_url: str | None = None) -> MCPServer:
    """Koostab serveri. `client`/`base_url` on testide jaoks süstitavad."""
    if client is None:
        settings = load_settings()
        client = VuttClient(settings)
        base_url = settings.base_url
    mcp = MCPServer("vutt", instructions=SERVER_INSTRUCTIONS)
    _register_text_tools(mcp, client, base_url)
    _register_person_tools(mcp, client, base_url)

    # Valikuline kirjanduskogu: registreerub ainult siis, kui indeks on olemas.
    from .library.config import load_library_settings
    from .library.tools import register_library_tools

    register_library_tools(mcp, load_library_settings())
    return mcp


def _register_text_tools(mcp: MCPServer, client, base_url: str) -> None:
    @mcp.tool(structured_output=False)
    async def search_pages(
        query: str,
        collection: str | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        language: str | None = None,
        genre_id: str | None = None,
        work_id: str | None = None,
        relax_matching: bool = False,
        limit: int = 10,
        offset: int = 0,
    ) -> str:
        """Otsib VUTT-i varauusaegsete tekstide transkriptsioonidest ja tagastab
        lehekülje-katked. Kasuta, kui tahad teada, KUS midagi mainitakse.

        Otsing on vaikimisi range: kõik päringu sõnad peavad leheküljel esinema.
        Kui tulemusi ei tule, proovi relax_matching=true.

        SÕNAOSA: ühesõnaline päring otsib sõnaosana, nii et "orati" leiab
        "orationem", "orationes" jne — käändelõpuga täissõna leiab VÄHEM.
        Mitmesõnalises päringus tohib ainult VIIMANE sõna olla poolik:
        "oratio panegyr" ei leia "orationem panegyricam" (mõõdetud: 21 lehest
        2). Vaste algab alati sõna algusest — "gyricus" ei leia sõna
        "panegyricus".

        Tulemus on rühmitatud teose kaupa ja laotatud korpuse peale: ühest
        teosest näidatakse kuni 3 lehekülge, et üks teos ei täidaks kogu
        akent. KÕIK ühe teose vasted saad, kui annad work_id.

        work_id on teose püsiv lühikood (nanoid, nt "v7Kq2mXp") — kasuta seda
        otsingu piiramiseks ühe teosega. Filtriväärtusi saad list_filter_values'ist.

        Tulemuse `seisund` ütleb, kui usaldusväärne transkriptsioon on
        (skaala serveri juhendis).
        """
        # Teoseülene otsing laotatakse teoste peale: tõmbame üle ja kärbime
        # kuni PAGES_PER_WORK lehte teose kohta. Teosesiseses otsingus
        # (work_id antud) on kapp vale — seal ongi küsimus „kus SELLES teoses".
        kapp = 0 if work_id else queries.PAGES_PER_WORK
        body = queries.build_search_body(
            query,
            collection=collection,
            year_from=year_from,
            year_to=year_to,
            language=language,
            genre_id=genre_id,
            work_id=work_id,
            relax_matching=relax_matching,
            search_fields=queries.PAGE_SEARCH_FIELDS,
            limit=limit,
            offset=offset if work_id else 0,
        )
        if not work_id:
            queries.apply_spread_window(body, offset=offset, limit=limit)
        data = client.meili_search(body)
        hits = queries.cap_pages_per_work(data.get("hits", []), kapp)
        if not work_id:
            # Kärpimine käib enne offsetit, muidu ei oleks lehekülgede
            # järjestus lehelt lehele sama.
            hits = hits[offset:offset + limit]
        return fmt.format_search_hits(
            hits, data.get("totalHits", len(hits)), base_url=base_url
        )

    @mcp.tool(structured_output=False)
    async def search_works(
        query: str,
        collection: str | None = None,
        year_from: int | None = None,
        year_to: int | None = None,
        language: str | None = None,
        genre_id: str | None = None,
        relax_matching: bool = False,
        limit: int = 10,
        offset: int = 0,
    ) -> str:
        """Otsib sama päringuga, aga tagastab TEOSED, mitte üksikuid lehekülgi.
        Kasuta, kui tahad teada, MILLISED teosed teemat käsitlevad.

        Iga teose juures näidatakse kõige tugevama vastega lehekülg ja katke —
        see ütleb, miks teos vaste oli.
        """
        body = queries.build_search_body(
            query,
            distinct_works=True,
            collection=collection,
            year_from=year_from,
            year_to=year_to,
            language=language,
            genre_id=genre_id,
            relax_matching=relax_matching,
            search_fields=queries.WORK_SEARCH_FIELDS,
            limit=limit,
            offset=offset,
        )
        data = client.meili_search(body)
        hits = data.get("hits", [])
        return fmt.format_search_hits(
            hits, data.get("totalHits", len(hits)), base_url=base_url
        )

    @mcp.tool(structured_output=False)
    async def get_work(work_id: str) -> str:
        """Tagastab ühe teose metaandmed ja lehekülgede loendi seisunditega.

        work_id on teose püsiv lühikood (nanoid), mille saad search_works'ist
        või search_pages'ist.
        """
        data = client.meili_search(queries.build_work_overview_body(work_id))
        hits = data.get("hits", [])
        if not hits:
            raise VuttNotFound(
                f"Teost work_id={work_id} ei leitud. Otsi õige ID üles "
                f"search_works tööriistaga."
            )
        return _format_work(hits, base_url=base_url)

    @mcp.tool(structured_output=False)
    async def get_pages(work_id: str, from_page: int, to_page: int) -> str:
        """Tagastab teose lehekülgede vahemiku TÄISTEKSTI (kaasa arvatud mõlemad).

        NUMERATSIOON: from_page=12 tähendab VUTT-i sisemist 1-põhist
        järjestusnumbrit (skaneeringute järjekord) — MITTE trükise paginatsiooni
        ega foliatsiooni. Varauusaegse teose puhul on „p. 12", „fol. B2r" ja
        VUTT-i kaheteistkümnes skaneering üldjuhul kolm eri asja.

        Korraga kuni 20 lehekülge. Marginaalia tagastatakse eraldi märgistatuna,
        sest see on füüsiliselt eraldi tekstikiht.
        """
        span = int(to_page) - int(from_page) + 1
        if span < 1:
            raise VuttError("to_page peab olema >= from_page.")
        if span > MAX_PAGE_SPAN:
            raise VuttError(
                f"Küsisid {span} lehekülge, lubatud on kuni {MAX_PAGE_SPAN}. "
                f"Kitsenda vahemikku (nt {from_page}–{int(from_page) + MAX_PAGE_SPAN - 1}). "
                f"Teose mahu näed get_work tööriistaga."
            )
        data = client.meili_search(
            queries.build_work_pages_body(work_id, from_page, to_page)
        )
        return fmt.format_pages(
            data.get("hits", []), base_url=base_url, work_id=work_id
        )

    @mcp.tool(structured_output=False)
    async def list_filter_values(field: str) -> str:
        """Loetleb legaalsed väärtused ühe filtrivälja kohta koos teoste arvuga.

        Kasuta ENNE filtriga otsimist — ilma selleta on lihtne pakkuda väärtust,
        mida indeksis ei ole, ja saada tühi tulemus.

        Lubatud väljad: collections, languages, genres, types.
        Keeled on ISO-koodid (lat, deu, grc, est…), žanrid ja tüübid Wikidata
        Q-koodid.
        """
        attribute = queries.FACET_FIELDS.get(field)
        if attribute is None:
            raise VuttError(
                f"Tundmatu filtriväli „{field}\". Lubatud: "
                + ", ".join(sorted(queries.FACET_FIELDS))
            )
        data = client.meili_search(queries.build_facets_body(attribute))
        values = (data.get("facetDistribution") or {}).get(attribute) or {}
        if not values:
            return f"Väljal „{field}\" ei ole indeksis ühtki väärtust."

        rows = sorted(values.items(), key=lambda kv: (-kv[1], kv[0]))
        lines = [f"{field} ({len(rows)} väärtust):"]
        lines += [f"  {name} — {count} lk" for name, count in rows]
        if len(rows) >= queries.FACET_VALUE_CAP:
            # Meili maxValuesPerFacet piirab tagastust; loend võib olla poolik.
            lines.append(
                f"  NB: loend on mittetäielik — Meili tagastab kuni "
                f"{queries.FACET_VALUE_CAP} facet-väärtust."
            )
        return "\n".join(lines)


def _format_work(hits: list[dict], *, base_url: str) -> str:
    """Teose metaandmed esimesest hitist + lehekülgede loend kanoonilises korras.

    Päring sorteerib lehekylje_number:asc (build_work_pages_body), aga
    `format_page_index` järjestab igaks juhuks ise — vahemike kodeering
    annaks vales järjekorras sisendil vaikselt vale tulemuse.
    """
    first = hits[0]
    work_id = first.get("work_id", "")
    header = fmt.format_fields([
        ("pealkiri", first.get("title")),
        ("aasta", first.get("aasta") or first.get("year_display")),
        ("koht", first.get("location")),
        ("žanr", first.get("genre")),
        ("keeled", first.get("languages")),
        ("kollektsioonid", first.get("collections")),
        ("work_id", work_id),
        ("lehekülgi", first.get("teose_lehekylgede_arv") or len(hits)),
        ("vaata", fmt.work_url(work_id, base_url=base_url)),
    ])
    lines = [header]

    # Loojad rollidega: praeses, gratulandid ja eessõna autor (aui) elavad
    # AINULT `creators`-massiivis — tuletatud `autor`/`respondens` neid ei kata.
    creator_list = first.get("creators") or []
    creators = fmt.format_creators(creator_list)
    if creators:
        lines += ["", "Isikud:", creators]
        # Legend ainult siis, kui on midagi seletada — vt needs_role_legend.
        if fmt.needs_role_legend(creator_list):
            lines += ["", fmt.CREATOR_ROLE_LEGEND]
    elif first.get("autor") or first.get("respondens"):
        lines += ["", fmt.format_fields([
            ("autor", first.get("autor")),
            ("respondens", first.get("respondens")),
        ])]

    lines += ["", fmt.format_page_index(hits, base_url=base_url, work_id=work_id)]
    return "\n".join(lines)


def _register_person_tools(mcp: MCPServer, client, base_url: str) -> None:
    @mcp.tool(structured_output=False)
    async def search_persons(
        q: str | None = None,
        gender: str | None = None,
        occupation: str | None = None,
        origin_group: str | None = None,
        institution: str | None = None,
        status_id: str | None = None,
        source: str | None = None,
        imm_year_from: int | None = None,
        imm_year_to: int | None = None,
        collection: str | None = None,
        limit: int = 10,
        offset: int = 0,
    ) -> str:
        """Otsib VUTT-i prosopograafia andmebaasist (~2350 varauusaegset isikut:
        professorid, üliõpilased, trükkalid, autorid).

        Nimevariandid on kaetud: „Ludenius" leiab ka „Lorenz Luden" — otsing
        arvestab ladina- ja saksapäraseid nimekujusid.

        imm_year on Tartu ülikooli immatrikuleerumise aasta.
        """
        return persons.search(
            client,
            base_url,
            q=q,
            gender=gender,
            occupation=occupation,
            origin_group=origin_group,
            institution=institution,
            status_id=status_id,
            source=source,
            imm_year_from=imm_year_from,
            imm_year_to=imm_year_to,
            collection=collection,
            limit=min(int(limit), 50),
            offset=offset,
        )

    @mcp.tool(structured_output=False)
    async def get_person(person_id: str, include_relations: bool = False) -> str:
        """Tagastab ühe isiku täisandmed: elukäik, haridus, ametid, päritolu ja
        seotud teosed rollidega (autor, praeses, respondens jne).

        person_id on kujul „vutt:Pfxxxsc" — saad selle search_persons'ist.

        include_relations=true lisab teostest tuletatud isiku-isiku seosed
        (kellega on ühiseid teoseid).

        Väljundi maht on piiratud: seotud teoseid näidatakse kuni 50 (koguarv
        on alati näha) — produktiivsel professoril võib neid olla üle 170.
        """
        return persons.detail(client, base_url, person_id, include_relations)
