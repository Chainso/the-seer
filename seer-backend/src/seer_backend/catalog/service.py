"""Catalog read-model composition service."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from hashlib import sha1
from re import sub
from typing import Any

from seer_backend.actions.models import ActionStatus
from seer_backend.catalog.models import (
    CatalogActionDetailResponse,
    CatalogActionListItem,
    CatalogActionListResponse,
    CatalogActionRunItem,
    CatalogActionRunsResponse,
    CatalogConceptLink,
    CatalogEventDetailResponse,
    CatalogEventListItem,
    CatalogEventListResponse,
    CatalogEventOccurrenceItem,
    CatalogEventOccurrencesResponse,
    CatalogObjectDetailResponse,
    CatalogObjectInstanceItem,
    CatalogObjectInstancesResponse,
    CatalogObjectListItem,
    CatalogObjectListResponse,
    CatalogTriggerDetailResponse,
    CatalogTriggerFiringItem,
    CatalogTriggerFiringsResponse,
    CatalogTriggerListItem,
    CatalogTriggerListResponse,
)
from seer_backend.ontology.models import OntologySparqlQueryResponse

_KIND_BY_CATEGORY = {
    "ObjectModel": "objects",
    "Action": "actions",
    "Event": "events",
    "EventTrigger": "triggers",
}

_SUPPORTED_KINDS = frozenset(_KIND_BY_CATEGORY.values())

_COMMENT_QUERY = """
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX prophet: <http://prophet.platform/ontology#>
SELECT DISTINCT ?concept ?comment
WHERE {
  VALUES ?categoryIri {
    prophet:ObjectModel
    prophet:Action
    prophet:Event
    prophet:EventTrigger
  }
  ?concept a ?typeIri .
  ?typeIri rdfs:subClassOf* ?categoryIri .
  OPTIONAL { ?concept rdfs:comment ?comment . }
}
""".strip()

_OBJECT_EVENT_QUERY = """
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX prophet: <http://prophet.platform/ontology#>
SELECT DISTINCT ?object ?event
WHERE {
  ?object a ?objectType .
  ?objectType rdfs:subClassOf* prophet:ObjectModel .
  ?event a ?eventType .
  ?eventType rdfs:subClassOf* prophet:Event .
  ?event prophet:hasProperty ?property .
  ?property prophet:valueType ?valueType .
  ?valueType prophet:referencesObjectModel ?object .
}
""".strip()

_ACTION_EVENT_QUERY = """
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX prophet: <http://prophet.platform/ontology#>
SELECT DISTINCT ?action ?event
WHERE {
  ?action a ?actionType .
  ?actionType rdfs:subClassOf* prophet:Action .
  ?action prophet:producesEvent ?event .
  ?event a ?eventType .
  ?eventType rdfs:subClassOf* prophet:Event .
}
""".strip()

_TRIGGER_LINKS_QUERY = """
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX prophet: <http://prophet.platform/ontology#>
SELECT DISTINCT ?trigger ?event ?action
WHERE {
  ?trigger a ?triggerType .
  ?triggerType rdfs:subClassOf* prophet:EventTrigger .
  OPTIONAL {
    ?trigger prophet:listensTo ?event .
    ?event a ?eventType .
    ?eventType rdfs:subClassOf* prophet:Event .
  }
  OPTIONAL {
    ?trigger prophet:invokes ?action .
    ?action a ?actionType .
    ?actionType rdfs:subClassOf* prophet:Action .
  }
}
""".strip()


@dataclass(slots=True, frozen=True)
class _CatalogConcept:
    iri: str
    kind: str
    category: str
    name: str
    description: str | None
    catalog_key: str


@dataclass(slots=True)
class _CatalogIndex:
    by_iri: dict[str, _CatalogConcept]
    by_kind: dict[str, list[_CatalogConcept]]
    by_key: dict[str, dict[str, _CatalogConcept]]
    object_to_events: dict[str, set[str]]
    event_to_objects: dict[str, set[str]]
    action_to_events: dict[str, set[str]]
    event_to_actions: dict[str, set[str]]
    trigger_to_events: dict[str, set[str]]
    event_to_triggers: dict[str, set[str]]
    trigger_to_actions: dict[str, set[str]]
    action_to_triggers: dict[str, set[str]]
    action_to_objects: dict[str, set[str]]
    object_to_actions: dict[str, set[str]]
    object_to_triggers: dict[str, set[str]]
    trigger_to_objects: dict[str, set[str]]


class CatalogService:
    """Composes ontology, history, and action services into catalog contracts."""

    def __init__(
        self,
        *,
        ontology_service: Any,
        history_service: Any,
        actions_service: Any,
    ) -> None:
        self._ontology_service = ontology_service
        self._history_service = history_service
        self._actions_service = actions_service

    async def list_objects(
        self,
        *,
        search: str = "",
        limit: int = 200,
    ) -> CatalogObjectListResponse:
        index = await self._build_index()
        items: list[CatalogObjectListItem] = []
        for concept in self._filtered(index.by_kind["objects"], search=search, limit=limit):
            items.append(
                CatalogObjectListItem(
                    catalog_key=concept.catalog_key,
                    name=concept.name,
                    description=concept.description,
                    action_count=len(index.object_to_actions[concept.iri]),
                    event_count=len(index.object_to_events[concept.iri]),
                )
            )
        return CatalogObjectListResponse(items=items)

    async def list_actions(
        self,
        *,
        search: str = "",
        limit: int = 200,
    ) -> CatalogActionListResponse:
        index = await self._build_index()
        items: list[CatalogActionListItem] = []
        for concept in self._filtered(index.by_kind["actions"], search=search, limit=limit):
            items.append(
                CatalogActionListItem(
                    catalog_key=concept.catalog_key,
                    name=concept.name,
                    description=concept.description,
                    object_count=len(index.action_to_objects[concept.iri]),
                    trigger_count=len(index.action_to_triggers[concept.iri]),
                )
            )
        return CatalogActionListResponse(items=items)

    async def list_events(self, *, search: str = "", limit: int = 200) -> CatalogEventListResponse:
        index = await self._build_index()
        items: list[CatalogEventListItem] = []
        for concept in self._filtered(index.by_kind["events"], search=search, limit=limit):
            items.append(
                CatalogEventListItem(
                    catalog_key=concept.catalog_key,
                    name=concept.name,
                    description=concept.description,
                    object_count=len(index.event_to_objects[concept.iri]),
                    trigger_count=len(index.event_to_triggers[concept.iri]),
                )
            )
        return CatalogEventListResponse(items=items)

    async def list_triggers(
        self,
        *,
        search: str = "",
        limit: int = 200,
    ) -> CatalogTriggerListResponse:
        index = await self._build_index()
        items: list[CatalogTriggerListItem] = []
        for concept in self._filtered(index.by_kind["triggers"], search=search, limit=limit):
            items.append(
                CatalogTriggerListItem(
                    catalog_key=concept.catalog_key,
                    name=concept.name,
                    description=concept.description,
                    event_count=len(index.trigger_to_events[concept.iri]),
                    action_count=len(index.trigger_to_actions[concept.iri]),
                )
            )
        return CatalogTriggerListResponse(items=items)

    async def object_detail(self, catalog_key: str) -> CatalogObjectDetailResponse:
        index = await self._build_index()
        concept = self._resolve(index, kind="objects", catalog_key=catalog_key)
        return CatalogObjectDetailResponse(
            catalog_key=concept.catalog_key,
            name=concept.name,
            description=concept.description,
            documentation=concept.description,
            object_type_uri=concept.iri,
            actions=self._links(index, index.object_to_actions[concept.iri]),
            events=self._links(index, index.object_to_events[concept.iri]),
            triggers=self._links(index, index.object_to_triggers[concept.iri]),
        )

    async def action_detail(self, catalog_key: str) -> CatalogActionDetailResponse:
        index = await self._build_index()
        concept = self._resolve(index, kind="actions", catalog_key=catalog_key)
        return CatalogActionDetailResponse(
            catalog_key=concept.catalog_key,
            name=concept.name,
            description=concept.description,
            documentation=concept.description,
            objects=self._links(index, index.action_to_objects[concept.iri]),
            events=self._links(index, index.action_to_events[concept.iri]),
            triggers=self._links(index, index.action_to_triggers[concept.iri]),
        )

    async def event_detail(self, catalog_key: str) -> CatalogEventDetailResponse:
        index = await self._build_index()
        concept = self._resolve(index, kind="events", catalog_key=catalog_key)
        return CatalogEventDetailResponse(
            catalog_key=concept.catalog_key,
            name=concept.name,
            description=concept.description,
            documentation=concept.description,
            objects=self._links(index, index.event_to_objects[concept.iri]),
            actions=self._links(index, index.event_to_actions[concept.iri]),
            triggers=self._links(index, index.event_to_triggers[concept.iri]),
        )

    async def trigger_detail(self, catalog_key: str) -> CatalogTriggerDetailResponse:
        index = await self._build_index()
        concept = self._resolve(index, kind="triggers", catalog_key=catalog_key)
        return CatalogTriggerDetailResponse(
            catalog_key=concept.catalog_key,
            name=concept.name,
            description=concept.description,
            documentation=concept.description,
            events=self._links(index, index.trigger_to_events[concept.iri]),
            actions=self._links(index, index.trigger_to_actions[concept.iri]),
            objects=self._links(index, index.trigger_to_objects[concept.iri]),
        )

    async def object_instances(
        self,
        *,
        catalog_key: str,
        page: int,
        size: int,
    ) -> CatalogObjectInstancesResponse:
        index = await self._build_index()
        concept = self._resolve(index, kind="objects", catalog_key=catalog_key)
        payload = await self._history_service.latest_objects(
            object_type=concept.iri,
            property_filters=[],
            page=page,
            size=size,
        )
        return CatalogObjectInstancesResponse(
            catalog_key=concept.catalog_key,
            name=concept.name,
            page=payload.page,
            size=payload.size,
            total=payload.total,
            total_pages=payload.total_pages,
            instances=[
                CatalogObjectInstanceItem(
                    instance_id=item.object_history_id,
                    recorded_at=item.recorded_at,
                    source_event_id=item.source_event_id,
                    reference=item.object_ref,
                    data=_strip_type_keys(item.object_payload),
                )
                for item in payload.items
            ],
        )

    async def action_runs(
        self,
        *,
        catalog_key: str,
        page: int,
        size: int,
        status: ActionStatus | None,
    ) -> CatalogActionRunsResponse:
        index = await self._build_index()
        concept = self._resolve(index, kind="actions", catalog_key=catalog_key)
        actions, total = await self._actions_service.list_actions(
            user_id=None,
            status=status,
            action_uri=concept.iri,
            page=page,
            size=size,
        )
        return CatalogActionRunsResponse(
            catalog_key=concept.catalog_key,
            name=concept.name,
            page=page,
            size=size,
            total=total,
            runs=[
                CatalogActionRunItem(
                    run_id=action.action_id,
                    status=action.status.value,
                    submitted_at=action.submitted_at,
                    updated_at=action.updated_at,
                    completed_at=action.completed_at,
                    attempt_count=action.attempt_count,
                    last_error_code=action.last_error_code,
                    last_error_detail=action.last_error_detail,
                )
                for action in actions
            ],
        )

    async def event_occurrences(
        self,
        *,
        catalog_key: str,
        limit: int,
    ) -> CatalogEventOccurrencesResponse:
        index = await self._build_index()
        concept = self._resolve(index, kind="events", catalog_key=catalog_key)
        timeline = await self._history_service.event_timeline(
            start_at=None,
            end_at=None,
            event_type=concept.iri,
            limit=limit,
        )
        return CatalogEventOccurrencesResponse(
            catalog_key=concept.catalog_key,
            name=concept.name,
            limit=limit,
            occurrences=[
                CatalogEventOccurrenceItem(
                    event_id=item.event_id,
                    occurred_at=item.occurred_at,
                    source=item.source,
                    trace_id=item.trace_id,
                    produced_by_execution_id=item.produced_by_execution_id,
                    payload=_strip_type_keys(item.payload),
                )
                for item in timeline.items
            ],
        )

    async def trigger_firings(
        self,
        *,
        catalog_key: str,
        limit: int,
    ) -> CatalogTriggerFiringsResponse:
        index = await self._build_index()
        trigger = self._resolve(index, kind="triggers", catalog_key=catalog_key)

        event_concepts = [
            index.by_iri[event_iri]
            for event_iri in sorted(index.trigger_to_events[trigger.iri])
            if event_iri in index.by_iri
        ]
        action_concepts = [
            index.by_iri[action_iri]
            for action_iri in sorted(index.trigger_to_actions[trigger.iri])
            if action_iri in index.by_iri
        ]
        event_link = self._link(event_concepts[0]) if event_concepts else None
        action_link = self._link(action_concepts[0]) if action_concepts else None

        if not event_concepts:
            return CatalogTriggerFiringsResponse(
                catalog_key=trigger.catalog_key,
                name=trigger.name,
                event=event_link,
                action=action_link,
                limit=limit,
                firings=[],
            )

        timeline = await self._history_service.event_timeline(
            start_at=None,
            end_at=None,
            event_type=event_concepts[0].iri,
            limit=limit,
        )
        return CatalogTriggerFiringsResponse(
            catalog_key=trigger.catalog_key,
            name=trigger.name,
            event=event_link,
            action=action_link,
            limit=limit,
            firings=[
                CatalogTriggerFiringItem(
                    event_id=item.event_id,
                    occurred_at=item.occurred_at,
                    source=item.source,
                    trace_id=item.trace_id,
                    payload=_strip_type_keys(item.payload),
                )
                for item in timeline.items
            ],
        )

    async def _build_index(self) -> _CatalogIndex:
        concepts = await self._ontology_service.list_concepts(limit=5000)
        comment_rows = await self._select_rows(_COMMENT_QUERY)
        comments = self._comment_map(comment_rows)

        by_iri: dict[str, _CatalogConcept] = {}
        by_kind: dict[str, list[_CatalogConcept]] = {
            "objects": [],
            "actions": [],
            "events": [],
            "triggers": [],
        }
        by_key: dict[str, dict[str, _CatalogConcept]] = {
            "objects": {},
            "actions": {},
            "events": {},
            "triggers": {},
        }

        for concept in concepts:
            kind = _KIND_BY_CATEGORY.get(concept.category)
            if kind is None:
                continue
            description = comments.get(concept.iri)
            catalog_key = _build_catalog_key(concept.label, concept.iri)
            shaped = _CatalogConcept(
                iri=concept.iri,
                kind=kind,
                category=concept.category,
                name=concept.label,
                description=description,
                catalog_key=catalog_key,
            )
            by_iri[concept.iri] = shaped
            by_kind[kind].append(shaped)
            by_key[kind][catalog_key] = shaped

        for concepts_by_kind in by_kind.values():
            concepts_by_kind.sort(key=lambda item: (item.name.lower(), item.name, item.iri))

        object_to_events = self._map_pairs(
            await self._select_rows(_OBJECT_EVENT_QUERY),
            left_key="object",
            right_key="event",
            allowed_left={item.iri for item in by_kind["objects"]},
            allowed_right={item.iri for item in by_kind["events"]},
        )
        event_to_objects = _invert_map(object_to_events)

        action_to_events = self._map_pairs(
            await self._select_rows(_ACTION_EVENT_QUERY),
            left_key="action",
            right_key="event",
            allowed_left={item.iri for item in by_kind["actions"]},
            allowed_right={item.iri for item in by_kind["events"]},
        )
        event_to_actions = _invert_map(action_to_events)

        trigger_to_events: dict[str, set[str]] = defaultdict(set)
        trigger_to_actions: dict[str, set[str]] = defaultdict(set)
        for row in await self._select_rows(_TRIGGER_LINKS_QUERY):
            trigger_iri = row.get("trigger", "").strip()
            event_iri = row.get("event", "").strip()
            action_iri = row.get("action", "").strip()
            if trigger_iri in by_iri and by_iri[trigger_iri].kind == "triggers":
                if event_iri in by_iri and by_iri[event_iri].kind == "events":
                    trigger_to_events[trigger_iri].add(event_iri)
                if action_iri in by_iri and by_iri[action_iri].kind == "actions":
                    trigger_to_actions[trigger_iri].add(action_iri)
        event_to_triggers = _invert_map(trigger_to_events)
        action_to_triggers = _invert_map(trigger_to_actions)

        action_to_objects: dict[str, set[str]] = defaultdict(set)
        for action_iri, event_iris in action_to_events.items():
            for event_iri in event_iris:
                action_to_objects[action_iri].update(event_to_objects.get(event_iri, set()))
        object_to_actions = _invert_map(action_to_objects)

        object_to_triggers: dict[str, set[str]] = defaultdict(set)
        for object_iri, event_iris in object_to_events.items():
            for event_iri in event_iris:
                object_to_triggers[object_iri].update(event_to_triggers.get(event_iri, set()))

        trigger_to_objects: dict[str, set[str]] = defaultdict(set)
        for trigger_iri, event_iris in trigger_to_events.items():
            for event_iri in event_iris:
                trigger_to_objects[trigger_iri].update(event_to_objects.get(event_iri, set()))

        return _CatalogIndex(
            by_iri=by_iri,
            by_kind={kind: by_kind[kind] for kind in by_kind},
            by_key={kind: by_key[kind] for kind in by_key},
            object_to_events=object_to_events,
            event_to_objects=event_to_objects,
            action_to_events=action_to_events,
            event_to_actions=event_to_actions,
            trigger_to_events=trigger_to_events,
            event_to_triggers=event_to_triggers,
            trigger_to_actions=trigger_to_actions,
            action_to_triggers=action_to_triggers,
            action_to_objects=action_to_objects,
            object_to_actions=object_to_actions,
            object_to_triggers=object_to_triggers,
            trigger_to_objects=trigger_to_objects,
        )

    async def _select_rows(self, query: str) -> list[dict[str, str]]:
        result = await self._ontology_service.run_read_only_query(query)
        if not isinstance(result, OntologySparqlQueryResponse):
            return []
        if result.query_type != "SELECT":
            return []
        return result.bindings

    @staticmethod
    def _comment_map(rows: list[dict[str, str]]) -> dict[str, str]:
        comments: dict[str, str] = {}
        for row in rows:
            concept_iri = row.get("concept", "").strip()
            comment = row.get("comment", "").strip()
            if not concept_iri or not comment:
                continue
            if concept_iri not in comments:
                comments[concept_iri] = comment
        return comments

    @staticmethod
    def _map_pairs(
        rows: list[dict[str, str]],
        *,
        left_key: str,
        right_key: str,
        allowed_left: set[str],
        allowed_right: set[str],
    ) -> dict[str, set[str]]:
        pairs: dict[str, set[str]] = defaultdict(set)
        for row in rows:
            left = row.get(left_key, "").strip()
            right = row.get(right_key, "").strip()
            if left not in allowed_left or right not in allowed_right:
                continue
            pairs[left].add(right)
        return pairs

    @staticmethod
    def _resolve(index: _CatalogIndex, *, kind: str, catalog_key: str) -> _CatalogConcept:
        if kind not in _SUPPORTED_KINDS:
            raise ValueError(f"unsupported catalog kind '{kind}'")
        concept = index.by_key[kind].get(catalog_key)
        if concept is None:
            raise ValueError(f"catalog key '{catalog_key}' was not found for '{kind}'")
        return concept

    @staticmethod
    def _filtered(
        concepts: list[_CatalogConcept],
        *,
        search: str,
        limit: int,
    ) -> list[_CatalogConcept]:
        normalized = search.strip().lower()
        if not normalized:
            return concepts[:limit]
        filtered = [concept for concept in concepts if normalized in concept.name.lower()]
        return filtered[:limit]

    def _links(self, index: _CatalogIndex, iris: set[str]) -> list[CatalogConceptLink]:
        concepts = [index.by_iri[iri] for iri in iris if iri in index.by_iri]
        concepts.sort(key=lambda item: (item.name.lower(), item.name, item.iri))
        return [self._link(concept) for concept in concepts]

    @staticmethod
    def _link(concept: _CatalogConcept) -> CatalogConceptLink:
        return CatalogConceptLink(catalog_key=concept.catalog_key, name=concept.name)


def _invert_map(source: dict[str, set[str]]) -> dict[str, set[str]]:
    target: dict[str, set[str]] = defaultdict(set)
    for left, rights in source.items():
        for right in rights:
            target[right].add(left)
    return target


def _build_catalog_key(name: str, iri: str) -> str:
    normalized = sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    if not normalized:
        normalized = "catalog-item"
    if len(normalized) > 48:
        normalized = normalized[:48].rstrip("-")
    digest = sha1(iri.encode("utf-8")).hexdigest()[:10]
    return f"{normalized}-{digest}"


def _strip_type_keys(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    cleaned = dict(payload)
    cleaned.pop("object_type", None)
    cleaned.pop("event_type", None)
    return cleaned
