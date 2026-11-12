# Schela vs. alte panouri: ce e greșit, ce lipsește

Data: 2026-11-13. Baza: inventarul Schela (branch dev), research pe securitate și research pe operațiuni. Faptele marcate "verificat în repo" le-am confirmat citind codul. Sursele externe marcate "unverified" provin doar din rezumate de căutare.

Total: **P0: 8**, **P1: 9**, **P2: 9**.

Format: **Acum** (Schela, file:line) / **Alții** (panou + sursă) / **Fix** / **Mărime** (S/M/L).

---

## P0: găuri de securitate sau promisiuni încălcate

### P0.1 Panoul rulează doar pe HTTP și răspunde pe orice Host
- **Acum:** `installer/templates/nginx-panel.conf:1-24` are `listen 80 default_server`, `server_name _`, proxy la 127.0.0.1:9090; niciun bloc 443. `BETTER_AUTH_URL` e `http://IP` (`installer/install.sh:208,302`), deci cookie-urile sunt fără Secure (`src/auth/server.ts:127-149`). Fără security headers pe vhost-ul panoului. Parola admin și sesiunea circulă în clar; orice Host necunoscut pe :80 ajunge la panou.
- **Alții:** CloudPanel ține panoul pe 8443, recomandă acces doar de pe IP-urile tale sau prin VPN și Basic Auth opțional (https://www.cloudpanel.io/docs/v2/guides/best-practices/security/; comanda `clpctl` unverified). HestiaCP: nginx separat pe 8083 (unverified, https://wiki.linux-server-admin.com/software/panels/hestiacp/security).
- **Fix:** Schela are deja certbot webroot: cert pentru hostname-ul panoului, server 443 dedicat, 80 -> 301 pe acel host, `BETTER_AUTH_URL=https://...` (activează automat cookie-urile `__Host-` Secure). Fallback self-signed când există doar IP. `default_server` pe 80 și 443 întoarce 444, nu panoul. Headere: HSTS, nosniff, `X-Frame-Options DENY`.
- **Mărime:** M

### P0.2 Firewall: "deny", dezactivarea și ștergerea unei reguli nu au efect (verificat în repo)
- **Acum:** UI oferă acțiunea `deny` (`src/routes/_panel.firewall.tsx:170-176`), switch de activare (`:136`) și ștergere (`:244`). `apply_firewall` face doar `ufw allow` și sare peste reguli `deny` sau dezactivate (`installer/schela-apply:604-605`); `ufw delete` nu există nicăieri. Un port deschis o dată rămâne deschis până la reinstalare (`ufw --force reset` doar în `install.sh:321`). Regulile 22/80/443 apar dezactivabile în UI, dar apply le deschide mereu (`schela-apply:594-596`).
- **Alții:** HestiaCP gestionează singur iptables prin `v-add-firewall-rule` (unverified); CloudPanel integrează UFW (link P0.1). Lecția din research: un singur manager deține tot setul de reguli.
- **Fix:** apply reconstruiește setul complet la fiecare rulare (bază + porturi de modul + reguli din panou, inclusiv `ufw deny`), șterge ce nu mai e în state. Regulile de bază read-only în UI. Teste: regulă dezactivată => port închis; regulă deny => aplicată.
- **Mărime:** M

### P0.3 Setările "SSH port" și "Unattended upgrades" nu fac nimic (verificat în repo)
- **Acum:** pagina de setări expune portul SSH (`src/routes/_panel.settings.tsx:72`) și switch-ul "Unattended upgrades - Security patches only" (`:155`). Valorile ajung în state (`src/server/apply.ts:159`), dar `schela-apply:594` deschide mereu 22/tcp și nimic nu citește `autoUpdates`; installer-ul activează unattended-upgrades fix (`install.sh:331-333`). Cine mută sshd pe alt port după ce l-a setat în panou rămâne blocat (default deny). Switch-ul pe off nu oprește nimic.
- **Alții:** Forge activează săptămânal update-urile de securitate Ubuntu, fără reboot (unverified, https://forge.laravel.com/docs/servers/security). SpinupWP: update-uri de securitate automate (https://spinupwp.com/doc/server-site-security/).
- **Fix:** apply deschide `settings.sshPort` în UFW (22 rămâne deschis până confirmă adminul); `autoUpdates` scrie `/etc/apt/apt.conf.d/20auto-upgrades` cu `APT::Periodic::Unattended-Upgrade "1"` sau `"0"`. Alternativ: scoate controalele din UI până există implementare.
- **Mărime:** S

### P0.4 Mail: porturi deschise fără serviciu configurat, parole în clar (verificat în repo)
- **Acum:** `install.sh:327` deschide 25, 587, 993. Schela nu configurează submission pe 587, nici TLS sau listener imaps pe 993: `99-schela.conf` declară doar `inet_listener imap { port = 143 }` (`schela-apply:687-751`); ce răspunde pe 587/993 e doar default-ul pachetului din distro. Dovecot acceptă parole în clar (`auth_allow_cleartext = yes` la `:699`, `disable_plaintext_auth = no` la `:732`). Postfix: fără `smtpd_tls_*`, fără SASL. Port 143 nu e deschis în UFW. Porturile de mail (și 53 pentru DNS) sunt deschise doar de installer, nu de apply: modulul activat ulterior din panou nu deschide nimic. Concluzie: niciun client extern nu are o cale configurată și sigură.
- **Alții:** HestiaCP livrează Exim4 + Dovecot complet, cu relay SMTP configurabil și DKIM (https://hestiacp.com/docs/server-administration/email.html).
- **Fix:** Dovecot `ssl = required` cu certul LE al hostname-ului de mail, listener imaps 993, cleartext permis doar pe localhost (webmail); Postfix submission 587 cu STARTTLS + SASL prin Dovecot, `smtpd_tls_*` pe 25. Porturile de modul deschise de `apply_firewall`, nu de installer. Până atunci: nu deschide 587/993.
- **Mărime:** L (S pentru varianta "închide porturile")

### P0.5 DKIM publicat în DNS, dar mailul pleacă nesemnat (verificat în repo)
- **Acum:** cheia e generată cu `opendkim-genkey` și pusă ca TXT în zonă (`schela-apply:668-675`, `1038-1070`), dar nu există `opendkim.conf`/KeyTable/SigningTable și nici `smtpd_milters` în Postfix (grep `milter` în `installer/` și `src/`: zero). SPF și DMARC nu sunt generate.
- **Alții:** HestiaCP folosește selectorul `mail` și recomandă DMARC `v=DMARC1; p=quarantine; sp=quarantine; adkim=s; aspf=s;` (link P0.4). cPanel are pagina Email Deliverability cu status SPF/DKIM/DMARC per domeniu (unverified).
- **Fix:** apply generează KeyTable/SigningTable, pornește opendkim pe socket, setează `smtpd_milters`/`non_smtpd_milters`; record SPF și DMARC implicit în zonă. Test: mesaj trimis are `DKIM-Signature` valid.
- **Mărime:** M

### P0.6 Backup-ul "Everything" nu conține bazele de date (verificat în repo)
- **Acum:** eticheta din UI e "Everything" (sites, apps, mail) (`src/features/backups/backups.ts:5`), dar `collect_paths` ia doar `/home/<user>`, `/var/mail/schela` și `state.json` (`installer/schela-backup:65-96`). Lipsesc MariaDB/PostgreSQL (datele nu stau în /home), PGlite-ul panoului (`/var/lib/schela/pglite`), cheile DKIM, `auth.secret`, configurațiile. Arhiva se face din fișiere live. Nu există restore.
- **Alții:** HestiaCP: backup per user cu DB și restore per componentă (web, mail, DB, dirs) din UI (https://hestiacp.com/docs/server-administration/backup-restore). Forge: backup DB cu restore din UI (unverified, https://laravel.com/forge/docs/resources/database-backups).
- **Fix:** pentru fiecare DB din state: `mysqldump --single-transaction` / `pg_dump` în arhivă; include PGlite (dump consistent), `/var/lib/schela/dkim`, `auth.secret`, `redis.pass`. `schela-backup restore <arhivă> <componentă>` măcar în CLI. Până atunci, eticheta trebuie să spună ce conține.
- **Mărime:** M (restore în UI: vezi P1.2)

### P0.7 Certificatele reînnoite nu ajung în nginx (verificat în repo)
- **Acum:** `certbot certonly --webroot` (`schela-apply:1107-1114`); reînnoirea e lăsată pe `certbot.timer` din distro. Niciun hook în `/etc/letsencrypt/renewal-hooks` și niciun reload nginx la reînnoire. nginx servește certificatul vechi din memorie până la următorul apply care face reload (`schela-apply:1158`). Pe un server unde nu se schimbă nimic, certificatul expiră în browser; `certs.json` rămâne cu data veche.
- **Alții:** Plesk folosește Certbot cu reînnoire cu circa 30 de zile înainte de expirare (unverified). Research-ul nu acoperă cum declanșează alte panouri reload-ul.
- **Fix:** `/etc/letsencrypt/renewal-hooks/deploy/schela` cu `nginx -t && systemctl reload nginx` și reîmprospătarea `certs.json`. Alertă pe expirare: P1.3.
- **Mărime:** S

### P0.8 Secrete în clar
- **Acum:** parola admin inițială rămâne permanent în `/var/lib/schela/credentials` (`install.sh:213-216`, 0600 root). `bootstrap-admin.json` și linia din `admin.env` sunt șterse după crearea adminului (`src/auth/bootstrap-admin.ts:41-77`), `credentials` nu (verificat în repo). Cheia secretă S3 și cheia privată SSH pentru rsync stau necriptate în `state.json` (mode 0640, `src/server/apply.ts:212,218`) și în DB-ul panoului; `schela-backup` le citește din state (`:183`, `:296`).
- **Alții:** HestiaCP ține parolele SFTP de backup în clar, iar asta apare ca plângere (link P0.6). SpinupWP declară criptare AES-256 și stocare off-site a cheilor SSH (https://spinupwp.com/doc/server-site-security/).
- **Fix:** șterge `credentials` după primul login reușit (sau afișează parola o singură dată la finalul instalării). Secretele de backup în fișiere root-only (`/var/lib/schela/backup-keys/<job>`, 0600) scrise printr-un helper sudo write-only; `state.json` păstrează doar referința, panoul nu mai poate reciti secretul.
- **Mărime:** M

---

## P1: lipsuri importante

### P1.1 Login panou: fără 2FA, fără jail, fără allowlist
- **Acum:** doar email + parolă; testul `src/auth/server-fn-auth.test.ts:100` confirmă lipsa plugin-urilor 2FA/token. Rate limiter-ul Better Auth e activ implicit în producție, dar panoul stă în spatele nginx: trebuie verificat că vede IP-ul real, nu 127.0.0.1. Niciun `limit_req`, niciun jail fail2ban pentru panou.
- **Alții:** CloudPanel: 2FA + allowlist IP + Basic Auth (link P0.1). HestiaCP: TOTP și jail fail2ban pe 8083 (unverified). Incidentul cPanel CVE-2026-41940 arată că MFA nu oprește falsificarea sesiunii (https://thehackernews.com/2026/04/critical-cpanel-authentication.html): 2FA vine după TLS, nu în locul lui.
- **Fix:** TOTP + coduri de recovery; `limit_req` pe ruta de sign-in; log cu IP real + jail fail2ban; opțiune "panou doar din aceste IP-uri".
- **Mărime:** M

### P1.2 Backup: fără criptare, restore, verificare, alertă
- **Acum:** inventar §9: arhive necriptate, fără restore, fără test de restore, fără notificări la eșec, fără verificare de spațiu.
- **Alții:** cPanel: precheck de spațiu pe disc (https://docs.cpanel.net/whm/backup/backup-configuration/). Coolify alertează și când arhiva locală a reușit dar upload-ul a eșuat (unverified, https://coolify.io/docs/core/backup-and-recovery/instance-backup). Restore e categoria nr. 1 de plângeri pe forumul HestiaCP (unverified). Plesk: cheia per instalare face backup-ul criptat nerestaurabil pe alt server (unverified). restic/Kopia criptează client-side și deduplică fără lanțuri (unverified).
- **Fix:** restic sau Kopia cu parolă ținută de admin, afișată o dată; restore per componentă (site, DB, mail, panou); test de restore automat periodic într-un director temporar; alertă la orice eșec, inclusiv upload.
- **Mărime:** L

### P1.3 Alerte și monitorizare
- **Acum:** dashboard cu /proc și `df` (`src/features/dashboard/metrics.ts`); fără istoric, alerte, uptime check, monitorizare servicii.
- **Alții:** Forge: CPU/disc/memorie, doar email (https://laravel.com/forge/docs/servers/monitoring). RunCloud: canale Slack/Telegram/Discord/email, praguri, snooze (unverified). Coolify: rutare per eveniment (unverified, https://coolify.io/docs/core/notifications/events). Monitorizarea Plesk nu alertează când cade chiar Plesk (unverified).
- **Fix:** registru de canale (email, Telegram, webhook generic) reutilizat de toate evenimentele: backup eșuat, cert aproape de expirare, disc plin, unit systemd căzut (nginx, php-fpm, mariadb, panou); heartbeat către un URL extern.
- **Mărime:** M

### P1.4 Update-uri: panou, PHP din sury, apt
- **Acum:** update = rerulare installer (`install.sh:219-258`); fără `schela update`. Originea sury nu e adăugată explicit în unattended-upgrades. Node primește patch-uri doar la reinstalare.
- **Alții:** Forge: PHP din repo terț nu e acoperit de unattended-upgrades (unverified, https://laravel.com/forge/docs/knowledge-base/php-security-release-october-2026.md). Coolify face backup înainte de update și oprește update-ul dacă backup-ul eșuează (unverified). APT CVE-2026-109518 afectează Debian 12/13 și Ubuntu 22.04+ (unverified; de confirmat în DSA-6607-1 / USN).
- **Fix:** `schela update`: backup state + PGlite, build, migrări, rollback la versiunea anterioară dacă eșuează; originea sury în `Unattended-Upgrade::Origins-Pattern`; comandă pentru patch-uri Node; installer-ul actualizează întâi apt.
- **Mărime:** M

### P1.5 Citire între site-uri prin symlink
- **Acum:** `www-data` e în grupul fiecărui site (`schela-apply:246`), homes 750, iar template-urile nu au `disable_symlinks` (verificat în repo). Un site compromis poate crea în `www` un link către un fișier static al altui site, iar nginx îl servește. Regula pentru dotfiles se aplică pe URI, nu pe țintă.
- **Alții:** research-ul notează că, fiindcă nginx citește toate site-urile, e nevoie de `disable_symlinks if_not_owner` pe lângă userii per site (unverified; atenție la interacțiunea `from=$document_root` cu `brotli_static`). SpinupWP: user + pool per site (https://spinupwp.com/doc/understanding-php-pools/).
- **Fix:** `disable_symlinks if_not_owner from=$document_root;` în template-urile de site; test: link cross-site => 403.
- **Mărime:** S

### P1.6 Aplicațiile Node fără sandbox
- **Acum:** unitul scris de apply are doar `NoNewPrivileges` și `PrivateTmp` (`schela-apply:~343-360`), deși workerii au setul complet (`:~480-520`: `ProtectSystem=strict`, `ProtectHome=tmpfs`, `MemoryMax`, `CapabilityBoundingSet` gol etc.).
- **Alții:** research-ul nu a găsit documentație de sandboxing systemd la panourile studiate (necunoscut).
- **Fix:** același bloc de hardening ca la workeri, plus `MemoryMax` configurabil per aplicație.
- **Mărime:** S

### P1.7 Fail2ban doar cu default-urile distro
- **Acum:** fail2ban instalat (`install.sh:117,315,336`), fără `jail.local`; activ practic doar sshd. Dovecot acceptă parole în clar fără jail.
- **Alții:** Plesk: Fail2Ban activ implicit cu jail-uri predefinite (unverified, https://docs.plesk.com/en-US/obsidian/administrator-guide/server-administration/protection-against-brute-force-attacks-fail2ban.73381/). Research: jail-urile uzuale sunt sshd, login panou, nginx, postfix/dovecot.
- **Fix:** `jail.local` generat de apply: sshd (pe portul real), postfix, dovecot, panou (P1.1), nginx.
- **Mărime:** S

### P1.8 Loguri per site și audit
- **Acum:** fără `access_log`/`error_log` per site, fără logrotate, fără viewer (inventar §4, §11). Activity log există, fără IP.
- **Alții:** Forge păstrează istoricul comenzilor (cine, ce, când, status) (https://laravel.com/forge/docs/sites/commands). Viewer-ele altor panouri nu au fost verificate.
- **Fix:** log-uri per domeniu, logrotate, tail cu filtru în UI; activity log cu IP. Necesar și pentru jail-urile din P1.7.
- **Mărime:** M

### P1.9 Fără CI
- **Acum:** există teste unitare și matricea Docker pe 5 distribuții (`installer/test/docker.sh:12`), dar nu rulează automat (fără `.github`).
- **Alții:** backdoor-ul Webmin CVE-2019-15107 a intrat printr-un server de build compromis (unverified): pipeline-ul face parte din suprafața de atac. HestiaCP 1.9.9 a adăugat teste BATS cu fix-ul de securitate (https://www.linuxcompatible.org/story/hestiacp-199-releases-critical-security-patch-to-fix-root-rce-flaw/).
- **Fix:** CI pe push: `npm test`, typecheck, lint, matricea Docker; release-uri cu tag și checksum.
- **Mărime:** S

---

## P2: nice to have

| # | Ce | Alții | Fix | Mărime |
|---|---|---|---|---|
| P2.1 | Limite CPU/IO/disc per site (lipsesc, inventar §3) | Plesk cgroups, oprite implicit (unverified, https://docs.plesk.com/en-US/current/administrator-guide/plesk-administration/plesk-for-linux-cgroups-manager.78308/) | slice systemd per pool (`CPUQuota`, `MemoryMax`) + quota disc | M |
| P2.2 | Setări PHP per site (`max_execution_time`, `upload_max_filesize`, `post_max_size`) | SpinupWP le editează din dashboard (unverified) | câmpuri în site, scrise în pool | S |
| P2.3 | Antispam + pagină deliverability (SPF, DKIM, DMARC, MTA-STS, TLS-RPT, PTR, port 25 outbound) | HestiaCP SpamAssassin/ClamAV (link P0.4); ISPConfig Rspamd (unverified) | Rspamd ca motor unic; ClamAV doar opțional (memorie) | L |
| P2.4 | DNSSEC cu dezactivare sigură, secundar prin AXFR + TSIG | HestiaCP DNSSEC + cluster (https://hestiacp.com/docs/server-administration/dns.html); DirectAdmin revenire la zonă nesemnată (unverified) | chei + afișare DS, `allow-transfer` cu TSIG | M |
| P2.5 | Wildcard prin DNS-01 pe Bind-ul local | HestiaCP nu face wildcard fără DNS propriu (unverified) | TXT în zona locală sau RFC2136 | M |
| P2.6 | Deploy cu release-uri, rollback, hook cu token | Forge: symlink `current`, păstrează 4 release-uri, health check (https://laravel.com/forge/docs/sites/deployments) | releases + shared paths + prune la eșec | L |
| P2.7 | Token-uri API cu scope + rol read-only | HestiaCP access keys cu permisiuni și allowlist IP (docs HestiaCP, research operațiuni §8) | token revocabil, last-used, legat de audit | M |
| P2.8 | Bannere EOL pentru PHP/Node cu migrare în bloc | SpinupWP (unverified) | citește `versions.json`, propune mutarea site-urilor | S |
| P2.9 | Redis comun, fără izolare per site (inventar §8) | neacoperit de research | user ACL per site | M |

---

## Ce face Schela deja bine
- **Panou neprivilegiat + sudoers fix:** panoul rulează ca `schela`, iar sudoers are fie binare fără argumente utile, fie argumente fixe (`installer/templates/sudoers:1-8`): exact clasa de bug-uri CyberPanel/HestiaCP.
- **Validare allowlist în helper-ele root:** regex-uri și catalog (`schela-apply:17-23`), `realpath` în `schela-files`: lecția CWP (validare după normalizare, nu filtre denylist).
- **Cron ca user de site, nu prin sudo:** evită calea HestiaCP CVE-2026-12196.
- **User + pool PHP-FPM per site:** home 750, `open_basedir`, tmp și sesiuni per site, `disable_functions`: setul comun SpinupWP/RunCloud.
- **Workeri cu sandbox systemd complet:** peste ce documentează panourile studiate.
- **Fără `ssl_stapling`:** corect, Let's Encrypt a oprit OCSP pe 2025-08-06.
- **UFW, nu CSF:** CSF s-a închis pe 2025-08-31.
- **Un singur cont:** sign-up dezactivat și hook DB care refuză al doilea user.
- **DB și Redis doar local:** Redis cu parolă și comenzi periculoase redenumite, PostgreSQL cu scram-sha-256.
- **Teste installer pe 5 distribuții:** inclusiv pinning sudoers și validarea helper-elor.

## De sărit deliberat
- **Reselleri, pachete, planuri (cPanel, Plesk):** un singur admin, fără clienți.
- **CloudLinux/CageFS, chroot per site:** comercial sau cost mare; devii ISPConfig spun că chroot nu e graniță reală (unverified).
- **ModSecurity + OWASP CRS implicit:** false positives documentate ca povară de suport; CloudPanel recomandă WAF extern.
- **ClamAV/Imunify implicit:** memorie pe VPS mic.
- **Cluster DNS master-master (HestiaCP):** un singur server.
- **Control plane SaaS cu chei SSH (Forge, SpinupWP):** Schela e self-hosted, modelul ar aduce risc de flotă.
- **Incrementale în lanț (Plesk):** fragile; dacă e nevoie, dedup restic/Kopia.
- **`X-XSS-Protection` (trimis de SpinupWP):** învechit.
- **Auto-update forțat cu expirarea versiunilor vechi (CWP):** prea agresiv pentru un panou cu un singur admin; ajunge `schela update` + alertă.
