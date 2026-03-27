---
name: ultrakit:init
description: >
  Initialize ultrakit in the current project. Creates the .ultrakit directory
  with execution plans and developer docs scaffolding. Run this
  once per project to set up the ultrakit structure.
---

# Ultrakit Init

Initialize ultrakit in the current project by running the init script:

```bash
bash .agents/skills/ultrakit-init/init.sh
```

The script checks if `.ultrakit/` already exists in the project root. If it does, it reports that ultrakit is already initialized. Otherwise, it copies the starter structure from this skill's `scaffold/` directory into `.ultrakit/` at the project root.

Do not run this skill if `.ultrakit/` already exists unless the user explicitly wants to reinitialize.
