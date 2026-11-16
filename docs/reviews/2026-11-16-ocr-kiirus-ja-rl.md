# OCR-mudeli kiirus ja kvaliteet: MMFlash, HSD, RL (2026-11-16)

Märkus, mitte otsus. Taust: OCR jookseb LOSSis llama-serveriga (GGUF Q8_0). Mudelid on
LoRA-adapterid, mis treenitakse otse baasmudeli `unsloth/Qwen3.5-9B` peale (trükis ja Kurrent eraldi).
Kurrendi mudeli CER on umbes 4 % (holdout 2026-11-11, vt hinnangut allpool). Trükimudelil on CER 2,9 %,
aga ilma märgenduseta (`cer_plain`) ainult 0,7 %.

## 1. Kiirus

### MMFlash ([arXiv:2611.18482](https://arxiv.org/abs/2611.18482), 13.11.2026, „work in process")

Spekulatiivne dekodeerimine visuaalkeelemudelitele: abimudel pakub ühe sammuga ette 16 märki ja
põhimudel kontrollib need üle. Väljund jääb samaks (kadudeta). Testitud ka Qwen3.5-9B-ga: pildiülesannetel
keskmiselt umbes 3×, ChartQA-l kuni 3,6×.

**Meile praegu ei sobi:**
- Abimudel on treenitud baas-Qwen3.5-9B peal. Meie LoRA muudab sisekihte ja väljundi vorming
  (VUTT XML, ladina, saksa) on teine. Väljund jääks õigeks, aga kiirendus oleks väike.
  Oma abimudeli treenimiseks kasutasid nad 8× H100 ja 900 000 näidet.
- Vajab SGLangi või vLLM-i, meil on llama.cpp.
- OCR-is sõltub peaaegu iga märk pildist, ja just selliseid märke võtab abimudel vastu
  kõige harvemini (artikli järgi 22 % vs 46 %).
- Kiirendus kahaneb partiidega: ühe päringu korral 3,5×, 32 paralleelse päringu korral 1,6×.
- Pikka sõnasõnalist transkriptsiooni ei testitud: vastuse lagi oli 4096 märki, valimid 200 näidet.

### HSD ([arXiv:2602.12957](https://arxiv.org/abs/2602.12957), ECCV 2026), MMFlashi viide [40]

Treeningut ei vaja. Kiire tavaline OCR-torustik (PP-StructureV3) teeb lehest mustandi. Suur mudel
otsib viimase ~3 kinnitatud märgi järgi mustandist kohta, kust jätkata, ja kinnitab sealt mitu
märki ühe sammuga. Pärast töötleb ta lehe veel tervikuna läbi (lugemisjärjekord). HunyuanOCR-iga
OmniDocBenchil 2,78×, pikkadel dokumentidel kuni 7×. Kood: `github.com/whlscut/HSD`, käivitus HF
Transformersiga.

**Piirangud:**
- Kiirendus sõltub mustandi kvaliteedist. Artikkel ise ütleb, et käsikirjal on mustand vigane ja
  kiirendus väike. Tänapäevane torustik annaks varauusaegsest trükisest ja Kurrendist kehva mustandi.
- „Peaaegu kadudeta": aktsepteeritakse ka märke, mis pole mudeli esimene valik, kui tõenäosus on
  lähedal (lävi τ). Meil peaks kontroll olema range, mis on kadudeta, aga mõnevõrra aeglasem.
- Pildi kodeerimine ei kiirene, nii et lühikestel lehtedel on võit väike.

**Kus see meil sobiks:** lehed, millel on juba tekst olemas (re-OCR uue mudeliga, varem
läbi käinud Kurrendi lehed). Vana tekst on palju parem mustand kui ükski väline torustik.
llama.cpp-l on spekulatiivne dekodeerimine olemas (abimudeliga ja n-grammi otsinguga). Kontrollimata
on, kas jooksva päringu juurde saab etteantud mustandi kaasa anda. Esimene samm oleks vaadata
llama.cpp `--spec-*` võtmeid.

**Avatud küsimus:** kas kiirus on üldse kitsaskoht? Kui OCR jõuab tööga praegu järele, ei ole kiirust vaja.

## 2. Kvaliteet: RL (GRPO) pärast LoRA-t

**Mõte.** SFT/LoRA õpetab ennustama järgmist märki õige eelneva teksti põhjal. GRPO laseb mudelil
genereerida terve lehe ja premeerib otse lehe CER-i järgi. Nii saavad karistuse ka vead, mida SFT ei
näe: vahele jäetud read, kordusahelad ja vea edasikandumine.

**Kirjandus:**
- [RL makes MLLMs see better than SFT](https://arxiv.org/pdf/2510.16333): GRPO > SFT, suurim võit
  OCR-is, umbes +4 punkti (Qwen2.5-VL-3B).
- [OCR-Centric RL, mitmekeelne](https://arxiv.org/pdf/2503.18484): tasu on 1 − normaliseeritud
  redaktsioonikaugus (≈ CER) + karistus pikkuse ja korduste eest. LoRA/SFT halvendas mõõdikut,
  piiratud tasuga GRPO parandas.
- [DianJin-OCR-R1](https://arxiv.org/html/2508.13238v2): enne SFT, siis RL.

**Kust alustada: baasmudel või meie LoRA.** RL-i mõistlik alguspunkt on meie SFT tulemus,
mitte baas-Qwen3.5-9B. Kõik ülaltoodud tööd teevad enne SFT ja alles siis RL-i. Baasmudel ei oska
VUTT-i XML-märgendust ega loe Kurrenti hästi. Selle valimid saaksid peaaegu kõik halva tasu
ja pikkade (1–2k märki) väljundite peal oleks puhtalt RL-iga õppimine väga
ebaefektiivne. Kett oleks seega:

```
unsloth/Qwen3.5-9B → LoRA SFT (nagu praegu) → GRPO samal adapteril
```

Siin on eeldatud, et GRPO jätkab sama LoRA-adapteriga. Teine võimalus on ühendada see baasiga ja
teha uus LoRA.

**Tingimused:**
1. **RL-i lehed peavad SFT-st väljas olema.** Pärast mitut epohhi annab mudel treeninglehtedel
   peaaegu õige vastuse iga kord. GRPO õpib aga ainult sellest, et sama lehe valimid erinevad,
   ja kui valimid on ühesugused, õppesignaali ei ole. Seega jäetakse osa GT-st SFT-st välja ja see
   läheb RL-i jaoks. Teine võimalus on kasutada VUTT-i uusi inimparandusi. Kolmas võimalus on
   lühem SFT, mis jätab rohkem varieeruvust (seda ei ole katsetatud).
2. **Tasu peab katma märgenduse.** Kui tasu arvutada ainult paljalt tekstilt, õpib mudel märgenduse
   ära jätma. Tasu peaks olema CER märgendusega või eraldi `<f>`/`<m>`/`<i>` F1 komponent,
   lisaks karistus korduse ja pikkuse eest.
3. **Holdout tuleb enne suuremaks teha.** 19–20 lehega ei eristu paarikümnendiku protsendipunkti
   võit mürast.

**Kulu.** Umbes 8 valimit lehe kohta, igaüks 1–2k märki, ehk mitu korda kallim kui SFT. Rocketi
H100-del tehtav. Unsloth toetab GRPO-d ka visioonimudelitele.

**Hinnang.** Katsetada **eelkõige Kurrendi mudelil** (kasutajaga kokku lepitud 2026-11-16).
Trükimudelil on tähevigu vähe (`cer_plain` 0,7 %) ja märgenduse osas on võit ebakindel. Kurrendi
GT-s on osa kahtlane: Fable 5.2 jõudis parandajana 3,5 %-ni vs meie 4,0 % (2026-11-11), mis viitab,
et osa „veast" võib olla GT enda müra. Järjekord:

1. Vaata Kurrendi GT läbi ja tee holdout suuremaks.
2. Väike GRPO katse: 100–200 lehte, mida SFT ei näinud, tasu CER märgendusega.
3. Hinda holdoutil sama skriptiga nagu SFT mudelit.
