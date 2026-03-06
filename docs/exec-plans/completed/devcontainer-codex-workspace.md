# Post-MVP Exec Plan: Devcontainer Codex Workspace

**Status:** completed  
**Target order:** post-MVP track 7 (developer environment)  
**Agent slot:** DEV-ENV-1  
**Predecessor:** `docs/exec-plans/completed/assistant-turn-logging-and-zellij-debug-panel.md`  
**Successor:** TBD  
**Last updated:** 2026-03-06

---

## Objective

Add a repository devcontainer that supports:

1. running Codex with full access inside the container,
2. pushing the repo to git from inside the container,
3. running the existing Seer local-development workflows from inside the container,
4. preserving the existing zellij-based developer experience and test-data helper scripts.

## Why Now

Current local setup assumes host-installed tooling for Node, Python, uv, zellij, and Codex.

That makes it harder to:

1. open the monorepo in a reproducible container workspace,
2. run Codex in a trusted isolated environment,
3. keep the existing local developer workflow intact while moving into a containerized shell.

## Scope

1. Add `.devcontainer/` configuration for Seer monorepo development.
2. Install Codex, uv, zellij, and supporting CLI tools in the container image.
3. Mount host git/Codex credentials needed for authenticated git push and Codex usage.
4. Run `docker compose` inside the devcontainer boundary rather than against the host Docker daemon.
5. Make the existing zellij dev script work unchanged from inside the devcontainer.
6. Update developer docs for the devcontainer workflow.

## Non-Goals

1. Replacing existing Docker Compose service definitions.
2. Reworking test-data helper scripts beyond compatibility with the devcontainer workflow.
3. Adding separate devcontainer-only start scripts if the existing scripts can be adapted cleanly.

## Implementation Phases

## Phase 1: Container Runtime

**Goal:** provide a working devcontainer image and startup setup for Seer development.

Deliverables:

1. Devcontainer config for isolated volume-backed workspace development.
2. Container image installs Codex, uv, zellij, and shell tooling.
3. Post-create bootstrap seeds the isolated workspace and installs frontend/backend dependencies.
4. Codex defaults to full-access mode inside the container shell.

Exit criteria:

1. The repo opens in a devcontainer with required toolchain available.
2. `codex` defaults to full-access execution inside the container.
3. Git auth files are available for container-side pushes.

## Phase 2: Existing Workflow Compatibility

**Goal:** preserve the normal local dev flow inside the devcontainer.

Deliverables:

1. `scripts/dev-local-zellij.sh` works inside the devcontainer without manual env rewrites.
2. DB-backed local-dev flows run through the devcontainer-local Docker daemon.
3. README and env-template docs explain the devcontainer path and host write boundary.

Exit criteria:

1. The zellij workflow remains the primary single-command local-dev path inside the devcontainer.
2. Test-data helper scripts remain usable against the devcontainer-run backend.

## Acceptance Criteria

1. Opening the repo in the devcontainer provides Node, Python tooling, uv, zellij, and Codex.
2. The default `codex` shell command runs with approvals/sandbox disabled inside the devcontainer.
3. Git push from the devcontainer can use mounted host credentials.
4. `./scripts/dev-local-zellij.sh` works from inside the devcontainer using container-local Docker services.
5. Helper scripts for ingesting ontology/history test data still work with the backend running in the devcontainer.
6. Developer docs describe the devcontainer startup and runtime behavior.

## Risks and Mitigations

1. Risk: full-access Codex still has too much reach if the container drives the host Docker daemon.  
   Mitigation: run Docker-in-Docker so compose activity remains inside the devcontainer boundary.
2. Risk: readonly host SSH mount blocks normal host-key/known-host writes.  
   Mitigation: copy host SSH material into container-local `/root/.ssh` during bootstrap.
3. Risk: repeated bootstrap should not overwrite the isolated repo state.  
   Mitigation: seed the workspace volume only once using a marker file.

## Docs Impact

1. `README.md`: add devcontainer workflow docs and host write-boundary notes.
2. `seer-backend/.env.example`: clarify that DB-only docker localhost defaults still apply inside the devcontainer.
3. `docs/exec-plans/active/index.md`: update execution state after archive.
4. `docs/exec-plans/completed/README.md`: index the finished plan after archive.

## Decision Log

1. 2026-03-06: Use an isolated named volume for the devcontainer workspace so the container repo copy can diverge from the host checkout safely.
2. 2026-03-06: Keep `scripts/dev-local-zellij.sh` as the canonical entrypoint rather than introducing a second devcontainer-only script.
3. 2026-03-06: Default `codex` to full access inside the devcontainer because the container itself is the intended trust boundary for this workflow.
4. 2026-03-06: Run Docker inside the devcontainer rather than mounting the host Docker socket, because host Docker access would break the safety boundary even with an isolated repo volume.

## Completion Summary

1. Added an isolated-volume `.devcontainer/` setup that seeds the repo from the host checkout on first create while keeping the working copy inside Docker-managed storage.
2. Installed Codex, uv, ripgrep, neovim, git-lfs, and Zellij in the devcontainer image, with `codex` defaulting to full-access mode.
3. Kept host write access constrained to `~/.codex`, while copying host `~/.gitconfig` and `~/.ssh` into container-local config during bootstrap for git push support.
4. Preserved the existing `./scripts/dev-local-zellij.sh` and helper-script workflow without adding a second container-only entrypoint.
5. Added host-side helper scripts for bringing up the devcontainer, opening a shell, and resyncing from the host checkout.
6. Updated repository docs to explain the devcontainer shape, safety boundary, and local workflow behavior.

## Acceptance Evidence

1. Devcontainer config parse: `jq . .devcontainer/devcontainer.json` (pass).
2. Script syntax: `bash -n .devcontainer/bootstrap-workspace.sh .devcontainer/sync-from-host.sh scripts/dev-local-zellij.sh` (pass).
3. Full devcontainer image build: `devcontainer build --workspace-folder .` (pass after removing the broken Yarn APT source and switching Zellij install to the upstream release binary).

## Progress Tracking

- [x] Phase 1 complete
- [x] Phase 2 complete

Current status:

1. Phase 1 complete.
2. Phase 2 complete.
