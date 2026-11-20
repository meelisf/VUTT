/**
 * Ikoonisõnastik (ADR 0086): üks mõiste = üks ikoon, üks ikoon = üks mõiste.
 *
 * Siin on ikoonid, millel on rakenduses kindel TÄHENDUS. Neid imporditakse AINULT
 * siit, mitte otse `lucide-react`-ist — valvur `src/utils/__tests__/iconVocabularyGuard.test.ts`
 * kontrollib. Neutraalsed ikoonid (X, Loader2, Chevron*, Check, Trash2 …) tulevad
 * endiselt otse lucide'ist.
 *
 * Uus tähendusega ikoon: lisa siia + ADR 0086 tabelisse + valvuri `VOCABULARY`-sse.
 * Pere = ühine alus, erinev tunnus: `MessageSquare*` = märkused, `PanelRight*` = marginaalia.
 */
export {
  // Muuda (kirje, tekst, kommentaar, nimi)
  Pencil as EditIcon,

  // Märkuste pere
  MessageSquare as CommentIcon, // lehe märge, sõnum
  MessageSquarePlus as AddCommentIcon,
  MessageSquareQuote as TextAnnotationIcon, // märkus tekstilõigu kohta (<ann>)

  // Marginaalia pere
  PanelRightDashed as MarginaliaIcon, // lisa <m> plokk
  PanelRightOpen as MarginaliaShowIcon, // klõps avab veeru
  PanelRightClose as MarginaliaHideIcon, // klõps sulgeb veeru

  // Toimetaja vabatekst (teose märkused, isiku märkmed)
  StickyNote as NotesIcon,

  // Lehe pilt
  Crop as PageEditorIcon, // ava redaktor (pööre, kärbe, poolitus)
  Crop as CropIcon, // kärpetööriist, ootel kärbe
  Frame as PerspectiveIcon,
  Columns2 as SplitIcon, // lehe poolitus — AINULT see
  RotateCcw as RotateLeftIcon, // AINULT pööre, mitte taaste
  RotateCw as RotateRightIcon,

  // Muu
  GalleryHorizontal as CompareIcon, // eksemplaride kõrvutus
  ArchiveRestore as RestoreIcon, // taasta prügikastist, ajaloost, originaal
  ListRestart as ResetIcon, // lähtesta vaikeväärtustele
  Undo2 as UndoIcon, // võta viimane toiming tagasi
} from 'lucide-react';
