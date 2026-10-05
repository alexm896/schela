# Schela

A small, fast hosting control panel for a **fresh Ubuntu or Debian VPS**.

*Schelă* is Romanian for scaffolding — raise the frame, then put the sites on it.

**https://schela.org**


PHP 8.1–8.4, Node 18/20/22, per-site jails, UFW, optional mail and DNS. The panel is the source of truth — every site, app, firewall, mailbox, and zone is written onto the box.

## Install (about five minutes)

On a **new** Ubuntu 22.04 / 24.04 or Debian 12 machine as root. 2 GB RAM recommended.

```bash
git clone https://github.com/imariusalin/schela.git
cd schela
sudo bash install.sh
```

When it finishes it prints:

```text
Panel  http://<server-ip>/
```

Open that URL. Set the hostname, pick modules, leave isolation on. Then create a site.

## What you get

| Piece | What it does |
|---|---|
| **Sites** | Unix user + home jail + dedicated PHP-FPM pool + nginx vhost + optional Let's Encrypt |
| **Node apps** | Unprivileged systemd unit + reverse proxy |
| **Databases** | MariaDB and PostgreSQL on 127.0.0.1; users with full, read-write or read-only access per database |
| **Firewall** | UFW default-deny. Port 22 is always left open |
| **Mail** | Postfix virtual mailboxes |
| **DNS** | Bind master zones |

Sites never run as root. Each one is its own user (`s_…`) with `open_basedir` locked to its home.

## After install

```bash
sudo schela apply          # rewrite nginx / PHP / UFW / mail / DNS from panel state
sudo schela apply --dry-run
sudo schela doctor
sudo schela status
```

The panel writes `/var/lib/schela/state.json` and runs `sudo schela-apply`. Managed files live under `/etc/nginx/schela.d`, `/etc/nginx/schela-apps.d`, and `/etc/php/*/fpm/pool.d/schela-*`. Distro defaults are left alone.

## Layout

| Path | Role |
|---|---|
| `/opt/schela` | panel |
| `/var/lib/schela` | database + state |
| `/usr/local/sbin/schela-apply` | apply engine |
| `/home/<site-user>/www` | site files |

## Notes

- Run on a **new** machine. The installer resets UFW.
- Port 22 is always left open.
- `.example` / `.local` / `.test` domains skip Let's Encrypt.
- Mail and DNS packages are installed when those modules are in `SCHELA_MODULES` (default: all).
- Optional env: `SCHELA_HOSTNAME`, `SCHELA_MODULES=php,node,firewall,ssl`, `SCHELA_PANEL_PORT=9090`.

## License

MIT
