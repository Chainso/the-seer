"""Assistant skill discovery and progressive-disclosure loaders."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

_FRONTMATTER_PATTERN = re.compile(r"\A---\s*\n(.*?)\n---\s*(?:\n|$)", re.DOTALL)
_HEADING_PATTERN = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
_REFERENCE_PATTERN = re.compile(
    r"^\s*-\s+\[(?P<label>[^\]]+)\]\((?P<path>[^)]+)\)\s*"
    r"(?:(?:--|-|—)\s*(?P<description>.*))?$"
)


class AssistantSkillError(RuntimeError):
    """Base error for assistant skill discovery and loading."""


class AssistantSkillNotFoundError(AssistantSkillError):
    """Raised when the requested skill does not exist in configured roots."""


class AssistantSkillCollisionError(AssistantSkillError):
    """Raised when multiple skill directories define the same skill name."""


class AssistantSkillReferenceError(AssistantSkillError):
    """Raised when a skill reference cannot be resolved or read."""


@dataclass(frozen=True, slots=True)
class SkillReference:
    """One progressively-loadable reference declared by a skill."""

    id: str
    label: str
    relative_path: str
    description: str


@dataclass(frozen=True, slots=True)
class AssistantSkill:
    """Parsed assistant skill metadata and instructions."""

    name: str
    description: str
    instructions_markdown: str
    skill_file: Path
    root_dir: Path
    version: str | None
    allowed_tools: tuple[str, ...]
    references: tuple[SkillReference, ...]


@dataclass(frozen=True, slots=True)
class LoadedSkillReference:
    """Reference payload loaded on demand from a discovered skill."""

    skill_name: str
    reference: SkillReference
    content: str
    truncated: bool


class AssistantSkillRegistry:
    """Discovers assistant skills from configured local skill directories."""

    def __init__(self, skill_directories: list[str] | tuple[str, ...]) -> None:
        self._skill_directories = tuple(skill_directories)

    def configured_roots(self) -> tuple[Path, ...]:
        """Return existing configured roots, deduped by resolved path."""

        roots: list[Path] = []
        seen: set[Path] = set()
        for entry in self._skill_directories:
            candidate = Path(entry).expanduser()
            try:
                resolved = candidate.resolve()
            except OSError:
                resolved = candidate.absolute()
            if not resolved.exists() or not resolved.is_dir() or resolved in seen:
                continue
            seen.add(resolved)
            roots.append(resolved)
        return tuple(roots)

    def discover(self) -> dict[str, AssistantSkill]:
        """Discover skills beneath configured roots."""

        discovered: dict[str, AssistantSkill] = {}
        origins: dict[str, Path] = {}

        for root in self.configured_roots():
            for skill_file in sorted(root.glob("*/SKILL.md")):
                skill = _parse_skill_file(skill_file)
                existing = discovered.get(skill.name)
                if existing is None:
                    discovered[skill.name] = skill
                    origins[skill.name] = skill.skill_file
                    continue
                if existing.skill_file == skill.skill_file:
                    continue
                raise AssistantSkillCollisionError(
                    f"skill name collision for {skill.name!r}: "
                    f"{origins[skill.name]} and {skill.skill_file}"
                )

        return discovered

    def get(self, skill_name: str) -> AssistantSkill:
        """Fetch one skill by logical name."""

        discovered = self.discover()
        skill = discovered.get(skill_name)
        if skill is None:
            raise AssistantSkillNotFoundError(
                f"skill {skill_name!r} was not found in configured skill directories"
            )
        return skill

    def load_reference(
        self,
        *,
        skill_name: str,
        reference_id: str,
        max_chars: int = 24_000,
    ) -> LoadedSkillReference:
        """Load one declared reference for a discovered skill."""

        skill = self.get(skill_name)
        reference = next(
            (item for item in skill.references if item.id == reference_id),
            None,
        )
        if reference is None:
            raise AssistantSkillReferenceError(
                f"skill {skill_name!r} does not declare reference {reference_id!r}"
            )

        resolved_path = (skill.root_dir / reference.relative_path).resolve()
        try:
            resolved_path.relative_to(skill.root_dir.resolve())
        except ValueError as exc:
            raise AssistantSkillReferenceError(
                f"reference {reference.relative_path!r} escapes skill root"
            ) from exc

        if not resolved_path.exists() or not resolved_path.is_file():
            raise AssistantSkillReferenceError(
                f"reference file {reference.relative_path!r} is unavailable"
            )

        try:
            content = resolved_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise AssistantSkillReferenceError(
                f"failed to read reference {reference.relative_path!r}: {exc}"
            ) from exc

        truncated = len(content) > max_chars
        if truncated:
            content = content[:max_chars]

        return LoadedSkillReference(
            skill_name=skill.name,
            reference=reference,
            content=content,
            truncated=truncated,
        )


def _parse_skill_file(skill_file: Path) -> AssistantSkill:
    raw_text = skill_file.read_text(encoding="utf-8")
    frontmatter, body = _split_frontmatter(raw_text)
    metadata = yaml.safe_load(frontmatter) if frontmatter else {}
    if not isinstance(metadata, dict):
        metadata = {}

    name = str(metadata.get("name") or skill_file.parent.name).strip()
    if not name:
        raise AssistantSkillError(f"skill file {skill_file} does not define a usable name")

    description = str(metadata.get("description") or "").strip()
    version_value = metadata.get("version")
    version = str(version_value).strip() if version_value is not None else None
    allowed_tools = _parse_allowed_tools(metadata.get("allowed-tools"))

    return AssistantSkill(
        name=name,
        description=description,
        instructions_markdown=body.strip(),
        skill_file=skill_file.resolve(),
        root_dir=skill_file.parent.resolve(),
        version=version or None,
        allowed_tools=allowed_tools,
        references=_parse_references(body),
    )


def _split_frontmatter(raw_text: str) -> tuple[str, str]:
    match = _FRONTMATTER_PATTERN.match(raw_text)
    if not match:
        return "", raw_text
    return match.group(1), raw_text[match.end() :]


def _parse_references(markdown: str) -> tuple[SkillReference, ...]:
    in_references = False
    reference_level = 0
    parsed: list[SkillReference] = []

    for line in markdown.splitlines():
        heading_match = _HEADING_PATTERN.match(line)
        if heading_match:
            heading_level = len(heading_match.group(1))
            heading_text = heading_match.group(2).strip().lower()
            if in_references and heading_level <= reference_level:
                break
            if heading_text == "references":
                in_references = True
                reference_level = heading_level
            continue

        if not in_references:
            continue

        reference_match = _REFERENCE_PATTERN.match(line)
        if reference_match is None:
            continue

        relative_path = Path(reference_match.group("path").strip()).as_posix()
        parsed.append(
            SkillReference(
                id=relative_path,
                label=reference_match.group("label").strip(),
                relative_path=relative_path,
                description=(reference_match.group("description") or "").strip(),
            )
        )

    return tuple(parsed)


def _parse_allowed_tools(raw_value: object) -> tuple[str, ...]:
    if raw_value is None:
        return ()
    if isinstance(raw_value, str):
        values = raw_value.split()
    elif isinstance(raw_value, list):
        values = [str(item).strip() for item in raw_value]
    else:
        values = [str(raw_value).strip()]

    normalized: list[str] = []
    for value in values:
        cleaned = value.strip()
        if cleaned and cleaned not in normalized:
            normalized.append(cleaned)
    return tuple(normalized)
