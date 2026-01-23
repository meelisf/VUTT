# Serveri Puhastuse ja Turvalisuse Kontrollnimekiri (2026)

See dokument on meelespea serveri korrashoiuks pärast esmast seadistamist.

## 1. Failisüsteemi puhastus
Kustuta kodukaustast (`~`) või projekti kaustast ajutised failid, mida enam vaja pole:

- [ ] `nginx.conf.production`
- [ ] `nginx.host.conf`
- [ ] `vutt.nginx.conf`
- [ ] Vanad `.env` koopiad (nt `.env.bak`, `.evn`)
- [ ] `dist.zip` või muud arhiivid

## 2. Docker ja Kettaruum
Aja jooksul koguneb vanu pite ja konteinereid.

- [ ] Kustuta kasutamata objektid: `docker system prune -a` (NB! Küsimusele vasta 'y')
- [ ] Kontrolli kettakasutust: `df -h` (eriti `/dev/sda` või `/` partitsiooni)

## 3. Turvalisus ja Logid
- [ ] **UFW Tulemüür:** Veendu, et see on sisse lülitatud.
    ```bash
    sudo ufw status
    # Peab olema 'active' ja lubama 22, 80, 443, 10050
    ```
- [ ] **Nginx Logid:** Vaata, ega logid pole liiga suureks kasvanud.
    `ls -lh /var/log/nginx/`
    (Ubuntu logrotate peaks sellega ise tegelema, aga hea on kontrollida).

## 4. Varukoopiad
- [ ] Veendu, et `/home/meelisf/VUTT/data` ja `/home/meelisf/VUTT/state` on varundatud välisesse kohta (mitte ainult samasse serverisse).
- [ ] Kontrolli, kas `users.json` on alles ja terve.

## 5. SSL Sertifikaadid
- [ ] Kontrolli aegumist. TÜ sertifikaadid kehtivad tavaliselt 1-2 aastat.
- [ ] Asukoht: `/etc/nginx/certs/vutt/`
