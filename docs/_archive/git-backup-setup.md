# Git andmevarundus: privaatne GitHub repo + cron

> Ajutine juhend. Kustuta pärast seadistamist.

## 1. Loo privaatne GitHub repo

- GitHub > New repository > `vutt-data-backup`
- Private, ilma README-ta (tühi repo)

## 2. Genereeri serveris SSH deploy key

```bash
ssh vutt
ssh-keygen -t ed25519 -C "vutt-backup" -f ~/.ssh/vutt_github_deploy
# Paroolita (cron jaoks)
cat ~/.ssh/vutt_github_deploy.pub
```

## 3. Lisa deploy key GitHubi repos

- Repo Settings > Deploy keys > Add deploy key
- Kleebi pubkey, märgi **"Allow write access"**

## 4. Seadista SSH config serveris

```bash
cat >> ~/.ssh/config << 'EOF'
Host github-vutt
    HostName github.com
    User git
    IdentityFile ~/.ssh/vutt_github_deploy
    IdentitiesOnly yes
EOF
```

## 5. Lisa remote ja tee esmane push

```bash
cd ~/VUTT/data
git remote add github github-vutt:USERNAME/vutt-data-backup.git
git push -u github --all
```

## 6. Cron jobid

```bash
crontab -e
```

Lisa read:

```cron
# Öine git push GitHubi (kell 2 öösel)
0 2 * * * cd ~/VUTT/data && git push github --all 2>&1 | logger -t vutt-git-backup

# Iganädalane git fsck (pühapäev kell 3 öösel)
0 3 * * 0 cd ~/VUTT/data && git fsck --full 2>&1 | logger -t vutt-git-fsck
```

## 7. Verifitseeri

```bash
# Kontrolli käsitsi et push töötab
cd ~/VUTT/data && git push github --all

# Kontrolli GitHubist et commitid jõudsid kohale

# Kontrolli hiljem logist et cron töötas
journalctl -t vutt-git-backup --since today
journalctl -t vutt-git-fsck --since today
```

## Märkused

- .gitignore jätab jpg/png välja — ainult txt + json lähevad GitHubi (~47 MB)
- Tasuta GitHub privaatne repo mahutab kuni 5 GB
- Deploy key annab ligipääsu ainult sellele ühele repole (turvalisem kui personal access token)
- Asenda `USERNAME` oma GitHubi kasutajanimega
