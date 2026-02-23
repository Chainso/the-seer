# UI Adapters

Phase A scaffolds this boundary for canonical backend DTO to view-model mapping.

Rules:

1. Keep backend modules (`src/lib/backend-*.ts`) as contract owners.
2. Keep transformations side-effect free.
3. Use these adapters from route/components as richer UX models are introduced in later phases.
