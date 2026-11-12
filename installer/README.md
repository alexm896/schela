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

Then open `http://<server-ip>/` and finish hostname, modules, isolation.

## What happens when you click in the panel

The panel writes `/var/lib/schela/state.json` and runs `sudo schela apply`:

- **Sites** — system user, home jail, dedicated PHP-FPM pool, nginx vhost, optional Let’s Encrypt
- **Node apps** — unprivileged systemd unit + reverse proxy
- **Firewall** — UFW, default deny (22/80/443 always stay open)
- **Mail** — Postfix virtual mailboxes
- **DNS** — Bind master zones

Managed files live under `/etc/nginx/schela.d`, `/etc/nginx/schela-apps.d`, and `/etc/php/*/fpm/pool.d/schela-*`. Distro defaults are left alone.

## Commands

```bash
sudo schela apply          # rewrite the stack from panel state
sudo schela apply --dry-run
sudo schela doctor
sudo schela status
```

## Layout

| Path | Role |
|---|---|
| `/opt/schela` | panel code |
| `/var/lib/schela` | database + state |
| `/usr/local/sbin/schela-apply` | apply engine |
| `/usr/local/share/schela/versions.json` | PHP and Node versions (from `installer/versions.json`) |
| `/home/<site-user>/www` | site files |

Sites never run as root. Each site is its own Unix user.

## PHP and Node versions

`installer/versions.json` is the single list the installer, `schela-apply`, `schela doctor` and the panel read. `supported` versions are installed on new servers and offered for new sites and apps; `retired` ones are no longer installed or offered, but existing sites and apps keep running on them. The panel only offers supported versions that are installed on the box.

## Tests

```bash
installer/test/docker.sh                # every supported system
installer/test/docker.sh ubuntu:26.04   # one system
```

`SCHELA_TEST_NETWORK=0` skips `packages.sh`, which installs every PHP and Node version from the real repositories.

## Notes

- Run on a **new** machine. The installer resets UFW.
- Port 22 is always left open.
- `.example`, `.local`, and `.test` domains skip Let’s Encrypt.
