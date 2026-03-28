FROM mcr.microsoft.com/devcontainers/universal:2

ENV NVM_DIR=/usr/local/share/nvm

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
    && bash -lc 'set -euo pipefail \
      && source "$NVM_DIR/nvm.sh" \
      && nvm install node \
      && nvm alias default node \
      && nvm use node \
      && npm install -g @openai/codex \
      && NODE_VERSION="$(nvm version node)" \
      && NODE_BIN_DIR="$NVM_DIR/versions/node/${NODE_VERSION}/bin" \
      && ln -sf "$NODE_BIN_DIR/node" /usr/local/bin/node \
      && ln -sf "$NODE_BIN_DIR/npm" /usr/local/bin/npm \
      && ln -sf "$NODE_BIN_DIR/npx" /usr/local/bin/npx \
      && ln -sf "$NODE_BIN_DIR/codex" /usr/local/bin/codex' \
    && python3 -m pip install --no-cache-dir --break-system-packages uv \
    && rm -f /usr/local/bin/codex-real \
    && printf '#!/usr/bin/env bash\nexec /usr/local/bin/codex --dangerously-bypass-approvals-and-sandbox "$@"\n' > /usr/local/bin/codex-no-perm \
    && chmod +x /usr/local/bin/codex-no-perm \
    && chsh -s /bin/zsh root \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY bootstrap-workspace.sh /usr/local/share/devcontainer/bootstrap-workspace.sh
COPY sync-from-host.sh /usr/local/share/devcontainer/sync-from-host.sh
COPY sync-host-config.sh /usr/local/share/devcontainer/sync-host-config.sh
RUN chmod +x /usr/local/share/devcontainer/bootstrap-workspace.sh /usr/local/share/devcontainer/sync-from-host.sh /usr/local/share/devcontainer/sync-host-config.sh
