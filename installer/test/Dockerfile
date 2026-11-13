ARG BASE=ubuntu:24.04
FROM ${BASE}

ENV DEBIAN_FRONTEND=noninteractive
RUN echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections \
  && echo "postfix postfix/mailname string mail.schela-ci.dev" | debconf-set-selections \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends \
    python3 bash ca-certificates adduser tar rsync jq nginx openssl sudo curl \
    mariadb-server mariadb-client postgresql postgresql-client \
    postfix dovecot-core dovecot-imapd opendkim opendkim-tools \
  && (apt-get install -y --no-install-recommends sudo-rs || true) \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/schela
COPY installer /opt/schela/installer

CMD ["bash", "/opt/schela/installer/test/run.sh"]
