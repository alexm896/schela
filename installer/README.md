# Schela installer

Tiny hosting panel for Ubuntu 22.04/24.04/26.04 and Debian 12/13.

## Install (about five minutes)

On a **fresh VPS as root**:

```bash
git clone https://github.com/imariusalin/schela.git
cd schela
sudo bash install.sh
```

The script installs nginx, PHP-FPM 8.2-8.5 (packages.sury.org), Node 22/24/26, UFW, Fail2ban, and (optionally) Postfix/Dovecot and Bind. It builds this panel, puts it behind nginx, and locks incoming traffic to SSH/HTTP/HTTPS plus mail/DNS if those modules are on.

At the end it prints the panel URL and the admin username and password. The password is shown once: it is not saved on the server (the panel deletes `bootstrap-admin.json` as soon as it has created the admin). Running the installer again never creates a new admin or changes the password; it also deletes the `/var/lib/schela/credentials` file that older versions left with the password in it.

Then open `http://<server-ip>/` and finish hostname, modules, isolation.

## What happens when you click in the panel

The panel writes `/var/lib/schela/state.json` and runs `sudo schela apply`:

- **Sites** — system user, home jail, dedicated PHP-FPM pool, nginx vhost, optional Let’s Encrypt
- **Node apps** — unprivileged systemd unit + reverse proxy
- **Firewall** — UFW, default deny (22/80/443 always stay open)
- **Search**: Meilisearch and Typesense from releases pinned in `versions.json` (sha256 checked), each as its own user on 127.0.0.1 in a sandboxed systemd unit; per-site API keys through `schela-search`
- **Mail** — Postfix virtual mailboxes
- **DNS** — Bind master zones

Managed files live under `/etc/nginx/schela.d`, `/etc/nginx/schela-apps.d`, and `/etc/php/*/fpm/pool.d/schela-*`. Distro defaults are left alone.

## Commands

```bash
sudo schela apply          # rewrite the stack from panel state
sudo schela apply --dry-run
sudo schela doctor
sudo schela status
sudo schela reset-admin-password   # root only
```

`reset-admin-password` makes a random password, has the panel set it (Better Auth hashes it, as for a sign-in) and prints it once. The panel must be running.

## Layout

| Path | Role |
|---|---|
| `/opt/schela` | panel code |
| `/var/lib/schela` | database + state |
| `/usr/local/sbin/schela-apply` | apply engine |
| `/usr/local/share/schela/versions.json` | PHP and Node versions, pinned Meilisearch and Typesense releases (from `installer/versions.json`) |
| `/var/lib/schela/search` | Meilisearch and Typesense master keys (root only) |
| `/var/lib/schela/backup-keys` | backup S3 secret keys and SSH private keys (root only) |
| `/var/lib/meilisearch`, `/var/lib/typesense` | search engine data |
| `/home/<site-user>/www` | site files |

Sites never run as root. Each site is its own Unix user.

## PHP and Node versions

`installer/versions.json` is the single list the installer, `schela-apply`, `schela doctor` and the panel read. `supported` versions are installed on new servers and offered for new sites and apps; `retired` ones are no longer installed or offered, but existing sites and apps keep running on them. The panel only offers supported versions that are installed on the box.

## Meilisearch and Typesense

Off by default. Turning a module on installs the release pinned in `versions.json` after checking its sha256, runs it as its own user on 127.0.0.1 only, and keeps its master key in `/var/lib/schela/search` (root only). The panel never sees a master key: it asks `schela-search` for keys limited to one site or app, whose index names must start with `site<id>_` or `app<id>_`. Keys are shown once.

To move to a new release, change its version and both checksums in `versions.json` and apply. The data is copied to `pre-upgrade-<old version>` next to it before the new binary starts; a pinned version older than the installed one is never applied. Turning a module off stops the service; the binary, data and keys stay.

## Backup secrets

The S3 secret key and the SSH private key of a backup job are written by `schela-backup-keys` into `/var/lib/schela/backup-keys/job-<id>.s3` and `job-<id>.ssh` (directory 0700, files 0600, root). The helper only writes and deletes: the panel cannot read a secret back. The database and `state.json` keep only whether each one is set and a hint (the last four characters of the S3 secret, the SSH key's fingerprint); `schela-backup` reads the key files. Editing a job without a new secret keeps the stored one; deleting the job deletes its key files.

Secrets an older panel kept in its database and `state.json` (and the path of an SSH key file) are moved into the key files and removed from both on the next apply, which the panel also runs when the installer requests its login page at the end of an update. The original key file is left where it was.

## Tests

```bash
installer/test/docker.sh                # every supported system
installer/test/docker.sh ubuntu:26.04   # one system
```

`SCHELA_TEST_NETWORK=0` skips `packages.sh`, which installs every PHP and Node version from the real repositories, and `search.sh`, which installs, upgrades and checks the keys of the real Meilisearch and Typesense (downloads are kept in `.cache/`).

## Notes

- Run on a **new** machine. The installer resets UFW.
- Port 22 is always left open.
- `.example`, `.local`, and `.test` domains skip Let’s Encrypt.
