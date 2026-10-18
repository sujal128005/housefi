# PostgreSQL 16 with PostGIS, built on the official multi-platform PostgreSQL image (amd64 and arm64), because the
# postgis/postgis images are amd64 only and Oracle Cloud's free servers are arm64. The official image already has
# the PostgreSQL apt repository, which ships PostGIS for both platforms. The extension itself is created by the
# first migration.
FROM postgres:16-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-16-postgis-3 postgresql-16-postgis-3-scripts \
 && rm -rf /var/lib/apt/lists/*
