# VUTTi eraldi OCR-võti

Rakendatud tootmises 2026-09-27 (S27-05). SSH ligipääs on kasutaja kinnitusel
piiratud TÜ sisevõrgu/VPN-iga. Võtmepiirangud täiendavad seda kaitset.

## Praegune lahendus

- VUTTi host: `~/.ssh/vutt_ocr_ed25519` (privaatvõti, serverist ei väljastata).
- Backend: sama fail read-only mount'iga `/root/.ssh/id_ed25519` — olemasolev
  võtmelugeja ei vaja muutmist. Hosti üldine `id_ed25519` pole enam mountitud.
- OCR-server: konto `mf`, aadress `172.17.120.148`; `authorized_keys` uuel real
  `from="193.40.22.30",restrict`. Lähteaadress mõõdeti OCR-serveri nähtud
  `SSH_CONNECTION` põhjal ja kontrolliti VUTTi Dockeri võrgust autentimisega.
- `restrict` keelab PTY, TCP- ja agendiedastuse, X11-edastuse ning kasutaja
  SSH rc käivitamise. SFTP ja tavakäsud jäävad lubatuks: VUTT vajab SFTP
  failitoiminguid ning lõpetatud/koristatavate töökaustade `rm -rf` käsku.
- Hostivõtme kontroll jääb kasutusele (`known_hosts`, S27-06).

**Piir:** see on eraldi võti, mitte eraldi teenusekonto või failisüsteemi
isolatsioon. Võti annab endiselt `mf` konto faili- ja käsuõigused.
VUTTi backendi ülevõtmisel saab ründaja ühenduda lubatud lähteaadressilt.
Edasine õiguste kitsendamine vajab eraldi kontot ja OCR-töövoo failide
omanike/õiguste plaani. Senist üldvõtit ega tema authorized_keys kirjet ei
kustutatud, sest muud kasutused pole täielikult inventeeritud.

## Kontrollitud

Enne vahetust testiti uut võtit ühekordses konteineris VUTTi võrgust:
range hostivõtme kontroll; SFTP mkdir/write/rename/read/remove; SSH
koristuskäsk unikaalses `.vutt-keycheck-*` testkaustas väljaspool valvuri
AUTO-OCR puud. Testkaust koristati. PTY ja TCP forwarding keelati.

Vahetuse eel `scripts/check_inflight.py`: ühtki tööd polnud lennus.
Muudeti ainult backendi võtme mount ja käivitati
`docker compose up -d --no-deps backend`. Pildiserverit, Meilit ja
analüütikat ei taaskäivitatud. Backend kaotab restartimisel API-sessioonid.

Pärast vahetust kontrolliti jooksva konteineri võtme avalikku sõrmejälge,
VUTTi enda `sftp_open` kaudu AUTO-OCR kausta ligipääsu, backendi HTTP 200,
veebi HTTP 200 ja backendi/pildiserveri healthy olekut.
Täielikku GPU OCR-tööd selles kontrollis ei käivitatud.

## Tagasipööramine

VUTTi hostis on varasem compose:
`/home/meelisf/.vutt-compose-before-ocr-key-1790536051` (0600).
OCR-serveris on muudatuseelne
`~/.ssh/authorized_keys.bak-vutt-ocr-1790535797` (0600).

Kui vaja tagasi pöörduda, kontrolli esmalt pooleliolevaid töid. Muuda
compose'is AINULT võtme mount'i lähtefail tagasi `~/.ssh/id_ed25519`-ks ja
käivita `docker compose up -d --no-deps backend`. Ära kirjuta hilisemate
muudatuste korral tervet compose'i vana varukoopiaga üle. Uue authorized_keys
rea olemasolu ei sega vana võtit; eemaldamine ei ole tagasipöördumiseks vajalik.

Võtme edaspidisel vahetamisel testi uut võtit enne mount'i vahetust. Kui
võtmefail asendatakse uue inode'iga, taasloo backend-konteiner. Ära väljasta
privaatvõtit logidesse, vestlusse ega hoidlasse.
