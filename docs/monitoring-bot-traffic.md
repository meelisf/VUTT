# Bot/scraper liikluse jälgimine (Part D)

Eesmärk: teha "luba esialgu, jälgi, klassifitseeri ümber" poliitika reaalseks.
Praegu logib nginx HTML-lehed UA-ga (`vutt_access.log`), AGA `/api/images/` on
`access_log off` → pildikraapimine on nähtamatu. Umami näeb ainult brausereid.
Zabbix teeb uptime-kontrolli ja on tuleviku push-alertingu koht (D4, sügis 2026).

## D1 — Logi pildipäringud (eraldi fail)

`/etc/nginx/sites-available/vutt`, `location /api/images/` blokis ASENDA
`access_log off;` reaga:

    access_log /var/log/nginx/vutt_images.log;

Rakenda:

    sudo nginx -t && sudo systemctl reload nginx

## D2 — Piira logi kasvu (KOHUSTUSLIK)

Pildipäringuid on palju → ilma rotatsioonita täidab ketta.
Loo `/etc/logrotate.d/vutt-images`:

    /var/log/nginx/vutt_images.log {
        daily
        rotate 7
        size 100M
        compress
        missingok
        notifempty
        create 0640 www-data adm
        sharedscripts
        postrotate
            [ -f /var/run/nginx.pid ] && kill -USR1 `cat /var/run/nginx.pid`
        endscript
    }

Testi: `sudo logrotate -d /etc/logrotate.d/vutt-images` (dry-run).

## Privaatsus / säilitus

Pildi- ja lehelogid sisaldavad IP + User-Agent. Hoia säilitus LÜHIKE (7 rotatsiooni
ülal), ligipääs ADMIN-only, kasutus PIIRATUD väärkasutuse/koormuse jälgimisega —
mitte analüütika ega profileerimine.

## D3 — GoAccess raport + ülevaatuse rütm

Paigalda: `sudo apt-get install goaccess`

Genereeri staatiline HTML-raport (cron, nt iga öö):

    goaccess /var/log/nginx/vutt_access.log /var/log/nginx/vutt_images.log \
      --log-format=COMBINED -o /root/vutt-goaccess/report.html

RAPORT EI TOHI LEKKIDA (sisaldab IP/UA): hoia väljaspool web-rooti, `chmod 600`,
vaata AINULT SSH-tunneli või nginx basic-auth kaudu — MITTE avalik URL.

Cron (`sudo crontab -e`):

    15 3 * * * goaccess /var/log/nginx/vutt_access.log /var/log/nginx/vutt_images.log --log-format=COMBINED -o /root/vutt-goaccess/report.html 2>/dev/null

Ülevaatuse rütm: kord nädalas vaata top UA-d/IP-d. Tegutse, kui üks UA/IP domineerib
pildimahtu või kogub palju 429-sid → see on trigger Firecrawl / PerplexityBot /
OAI-SearchBot ümberklassifitseerimiseks (vt robots.txt Task 7).

## D4 — Zabbix alerting (EDASI LÜKATUD → sügis 2026)

Ülikooli Zabbix juba pingib saiti. Ideaal: push-alertid request-rate / bandwidth /
429 piikidele. Ootab IT-d (suvepuhkused). Vahepeal katab GoAccess + logid.

## Verifitseerimine (pärast D1)

    # Botina päring lehele (peab endiselt töötama)
    curl -s -A "Googlebot" https://vutt.utlib.ut.ee/work/<id> | grep -c data-page
    # Pildipäring peab nüüd logisse ilmuma
    curl -s -A "TestBot" https://vutt.utlib.ut.ee/api/images/<id>/_thumb -o /dev/null
    sudo tail -n 5 /var/log/nginx/vutt_images.log
