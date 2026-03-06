FROM mcr.microsoft.com/devcontainers/universal:2

RUN rm -f /etc/apt/sources.list.d/yarn.list \
    && apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends git-lfs jq neovim ripgrep rsync zsh \
    && ARCH="$(dpkg --print-architecture)" \
    && case "${ARCH}" in \
      amd64) ZELLIJ_ARCH="x86_64-unknown-linux-musl" ;; \
      arm64) ZELLIJ_ARCH="aarch64-unknown-linux-musl" ;; \
      *) echo "Unsupported architecture for Zellij: ${ARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSL "https://github.com/zellij-org/zellij/releases/latest/download/zellij-${ZELLIJ_ARCH}.tar.gz" -o /tmp/zellij.tar.gz \
    && tar -xzf /tmp/zellij.tar.gz -C /usr/local/bin zellij \
    && chmod +x /usr/local/bin/zellij \
    && rm /tmp/zellij.tar.gz \
    && npm install -g @openai/codex \
    && python3 -m pip install --no-cache-dir --break-system-packages uv \
    && CODEX_BIN="$(command -v codex)" \
    && mv "${CODEX_BIN}" /usr/local/bin/codex-real \
    && printf '#!/usr/bin/env bash\nexec /usr/local/bin/codex-real --dangerously-bypass-approvals-and-sandbox "$@"\n' > /usr/local/bin/codex \
    && chmod +x /usr/local/bin/codex \
    && chsh -s /bin/zsh root \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY bootstrap-workspace.sh /usr/local/share/devcontainer/bootstrap-workspace.sh
COPY sync-from-host.sh /usr/local/share/devcontainer/sync-from-host.sh
RUN chmod +x /usr/local/share/devcontainer/bootstrap-workspace.sh /usr/local/share/devcontainer/sync-from-host.sh
