# Docker Runtime Notes

This folder is reserved for runtime-specific configuration as Seer phases expand.

Runtime entrypoints:

1. Full stack: root `docker-compose.yml`
2. DB-only (Fuseki + ClickHouse): root `docker-compose.db.yml`
3. Local app + DB docker + zellij panes: `scripts/dev-local-zellij.sh`
