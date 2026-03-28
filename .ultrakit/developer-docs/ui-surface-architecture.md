# UI Surface Architecture

## Purpose

Describe the stable UI mental model in `seer-ui/`: the shared shell, the major product surfaces, the assistant runtime pattern, and the backend adapter boundary.

This doc is for engineers deciding where a new UI feature belongs and how it should connect to backend contracts.

## Shell Model

The app uses one shared shell wrapped around the main product surfaces.

That shell is responsible for:

1. primary navigation,
2. responsive desktop-versus-drawer behavior,
3. shared providers,
4. and the global assistant layer.

The shell is not a product surface by itself. It is the frame that hosts catalog discovery, managed-agent operations, assistant investigation, and retained expert diagnostics.

## Surface Organization

### Catalog

Catalog is the default discovery experience.

Its UI pattern is:

1. list-first browsing by concept kind,
2. detail screens that pair documentation with runtime evidence,
3. and an object detail experience that can expand into lifecycle-oriented analysis.

Catalog is intentionally a read-model experience. It is not a raw ontology graph browser.

### Assistant

The assistant surface is the primary investigation workspace.

Its core UI model is:

1. thread-based conversation,
2. shared assistant runtime state,
3. tool-driven artifact presentation,
4. and an optional attached canvas that stays scoped to the active thread.

The important architectural point is that the assistant is not an isolated chat widget. It is a first-class application surface using shared runtime infrastructure.

### Managed Agents

Managed-agent UI is grouped around authoring, definition review, run visibility, and nested execution inspection.

The surface is agent-first rather than execution-first. Users start from the managed agent, then drill into runs and audit details.

### Retained Expert Surfaces

History, analytics, and legacy ontology entry points remain in the UI for deep inspection and verification.

They are retained specialist surfaces, not the primary wayfinding model.

## Shared Runtime And State

### Assistant Runtime

The assistant UI uses `assistant-ui` with an external-store runtime adapter.

The durable UI contract is:

1. stored threads,
2. stored completion messages,
3. active-thread canvas state derived from persisted tool history,
4. and route/module context passed into backend assistant requests.

This means assistant state is a shared application concern, not local component state inside a single page.

### Providers

The shared shell wraps the app in providers for:

1. theming,
2. assistant state,
3. and ontology graph display concerns.

Global providers should stay limited to cross-surface concerns. Surface-specific state should remain within its own subsystem unless another surface truly shares it.

## Backend Adapter Boundary

UI modules talk to backend contracts through `app/lib/api/*`.

That boundary matters because:

1. surfaces should depend on backend contracts, not reconstruct them locally,
2. display helpers can shape backend payloads for UI presentation,
3. but backend orchestration and validation still belong on the server.

The UI may derive presentation state, sorting, and layout-specific shaping. It should not become the owner of ontology interpretation, execution policy, or durable runtime semantics.

## Risks Of Misunderstanding

1. Treating catalog as a renamed ontology explorer misses that it is a distinct read experience with documentation-plus-runtime presentation.
2. Treating assistant state as page-local leads to duplicated thread logic and broken cross-surface behavior.
3. Treating retained expert surfaces as the primary navigation model pulls the UI back toward the older ontology-first product identity.
4. Pushing business validation or execution policy into `app/lib` breaks the intended backend contract boundary.

## Extension Guidance

1. Put new discovery-first concepts into catalog when they are ontology-backed read experiences.
2. Put new investigation behaviors into the assistant surface when they belong in conversational evidence gathering.
3. Reuse retained expert surfaces for drill-down and verification instead of creating one-off visualizations when the data contract is already stable.
4. Add new shared providers only for cross-surface concerns that genuinely span multiple product surfaces.
