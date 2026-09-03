FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
    python3 bash ca-certificates adduser tar rsync jq nginx openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/schela
COPY installer /opt/schela/installer

CMD ["bash", "/opt/schela/installer/test/run.sh"]
