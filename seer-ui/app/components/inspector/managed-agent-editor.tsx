"use client";

import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  createManagedAgent,
  getManagedAgent,
  getManagedAgentEditorCatalog,
  updateManagedAgent,
  type ManagedAgentRequestError,
} from "@/app/lib/api/agentic-workflows";
import {
  buildManagedAgentHref,
  buildManagedAgentsIndexHref,
} from "@/app/lib/managed-agent-routes";
import type {
  ManagedAgentDetail,
  ManagedAgentEditorCatalog,
  ManagedAgentFieldDefinition,
  ManagedAgentUpsertRequest,
} from "@/app/types/agentic-workflows";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SearchableSelect } from "../ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import {
  TableBody,
  TableCell,
  TableColumnHeaderCell,
  TableHeader,
  TableRoot,
  TableRow,
} from "../ui/table";
import { Textarea } from "../ui/textarea";

type EditorMode = "create" | "edit";
type SchemaSection = "input" | "output";

interface ManagedAgentEditorProps {
  mode: EditorMode;
  managedAgentKey?: string;
}

interface FieldEditorState {
  open: boolean;
  section: SchemaSection;
  index: number | null;
  draft: ManagedAgentFieldDefinition;
}

const EMPTY_SELECT_VALUE = "__none__";
const MANAGED_AGENT_KEY_PATTERN = /^[a-z][a-z0-9_:-]{2,79}$/;

function createEmptyField(): ManagedAgentFieldDefinition {
  return {
    field_key: "",
    label: "",
    description: null,
    required: false,
    multi_value: false,
    field_type: "value_type",
    value_type_iri: null,
    object_model_iri: null,
  };
}

function createEmptyDraft(): ManagedAgentUpsertRequest {
  return {
    managed_agent_key: "",
    name: "",
    description: null,
    instruction: "",
    enabled: true,
    input_name: "",
    input_description: null,
    output_name: "",
    output_description: null,
    input_fields: [],
    output_fields: [],
  };
}

function trimOptional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeField(field: ManagedAgentFieldDefinition): ManagedAgentFieldDefinition {
  const normalized: ManagedAgentFieldDefinition = {
    ...field,
    field_key: field.field_key.trim(),
    label: field.label.trim(),
    description: trimOptional(field.description || ""),
    value_type_iri: trimOptional(field.value_type_iri || ""),
    object_model_iri: trimOptional(field.object_model_iri || ""),
  };

  if (normalized.field_type === "value_type") {
    normalized.object_model_iri = null;
  } else {
    normalized.value_type_iri = null;
  }

  return normalized;
}

function toDraft(detail: ManagedAgentDetail): ManagedAgentUpsertRequest {
  return {
    managed_agent_key: detail.managed_agent_key,
    name: detail.name,
    description: detail.description,
    instruction: detail.instruction,
    enabled: detail.enabled,
    input_name: detail.input_name,
    input_description: detail.input_description,
    output_name: detail.output_name,
    output_description: detail.output_description,
    input_fields: detail.input_fields,
    output_fields: detail.output_fields,
  };
}

function validateField(field: ManagedAgentFieldDefinition): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!field.field_key.trim()) {
    errors.field_key = "Field key is required.";
  }
  if (!field.label.trim()) {
    errors.label = "Field label is required.";
  }
  if (field.field_type === "value_type" && !(field.value_type_iri || "").trim()) {
    errors.value_type_iri = "Choose a value type.";
  }
  if (field.field_type === "object_reference" && !(field.object_model_iri || "").trim()) {
    errors.object_model_iri = "Choose an object model.";
  }
  return errors;
}

function validateDraft(draft: ManagedAgentUpsertRequest): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!draft.managed_agent_key.trim()) {
    errors.managed_agent_key = "Managed-agent key is required.";
  } else if (!MANAGED_AGENT_KEY_PATTERN.test(draft.managed_agent_key.trim())) {
    errors.managed_agent_key =
      "Use 3-80 characters, start with a letter, and limit characters to lowercase letters, digits, `_`, `:`, or `-`.";
  }

  if (!draft.name.trim()) {
    errors.name = "Name is required.";
  }
  if (!draft.instruction.trim()) {
    errors.instruction = "Instruction is required.";
  }
  if (!draft.input_name.trim()) {
    errors.input_name = "Input definition name is required.";
  }
  if (!draft.output_name.trim()) {
    errors.output_name = "Output event name is required.";
  }

  const validateFieldSet = (
    fields: ManagedAgentFieldDefinition[],
    fieldName: "input_fields" | "output_fields"
  ) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      const normalized = normalizeField(field);
      const fieldErrors = validateField(normalized);
      if (Object.keys(fieldErrors).length > 0) {
        errors[fieldName] = `Fix ${fieldName === "input_fields" ? "input" : "output"} field ${index + 1}.`;
      }
      const lowered = normalized.field_key.toLowerCase();
      if (lowered) {
        if (seen.has(lowered)) {
          errors[fieldName] = `Field keys must be unique in ${fieldName === "input_fields" ? "input" : "output"} schema.`;
        }
        seen.add(lowered);
      }
    });
  };

  validateFieldSet(draft.input_fields, "input_fields");
  validateFieldSet(draft.output_fields, "output_fields");

  return errors;
}

function normalizeDraft(draft: ManagedAgentUpsertRequest): ManagedAgentUpsertRequest {
  return {
    ...draft,
    managed_agent_key: draft.managed_agent_key.trim(),
    name: draft.name.trim(),
    description: trimOptional(draft.description || ""),
    instruction: draft.instruction.trim(),
    input_name: draft.input_name.trim(),
    input_description: trimOptional(draft.input_description || ""),
    output_name: draft.output_name.trim(),
    output_description: trimOptional(draft.output_description || ""),
    input_fields: draft.input_fields.map(normalizeField),
    output_fields: draft.output_fields.map(normalizeField),
  };
}

function ErrorText({ message }: { message?: string }) {
  return message ? <p className="text-sm text-destructive">{message}</p> : null;
}

function SchemaFieldsTable({
  title,
  description,
  fields,
  onAdd,
  onEdit,
  onRemove,
  valueTypeLabels,
  objectModelLabels,
}: {
  title: string;
  description: string;
  fields: ManagedAgentFieldDefinition[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  valueTypeLabels: Map<string, string>;
  objectModelLabels: Map<string, string>;
}) {
  const displayTarget = (field: ManagedAgentFieldDefinition): string => {
    if (field.field_type === "value_type") {
      return valueTypeLabels.get(field.value_type_iri || "") || field.value_type_iri || "Value type";
    }
    return objectModelLabels.get(field.object_model_iri || "") || field.object_model_iri || "Object model";
  };

  return (
    <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {title}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button type="button" variant="outline" onClick={onAdd}>
          <Plus className="h-4 w-4" />
          Add Field
        </Button>
      </div>

      {fields.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No fields defined yet.
        </div>
      ) : (
        <div className="mt-5">
          <TableRoot variant="surface" striped>
            <TableHeader>
              <TableRow>
                <TableColumnHeaderCell>Field</TableColumnHeaderCell>
                <TableColumnHeaderCell>Type</TableColumnHeaderCell>
                <TableColumnHeaderCell>Cardinality</TableColumnHeaderCell>
                <TableColumnHeaderCell>Actions</TableColumnHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fields.map((field, index) => (
                <TableRow key={`${field.field_key}-${index}`}>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="font-medium">{field.label || "Untitled field"}</div>
                      <div className="text-xs text-muted-foreground">
                        Key: {field.field_key || "Unset"}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <Badge variant="outline" className="rounded-full">
                        {field.field_type === "object_reference" ? "Object reference" : "Value type"}
                      </Badge>
                      <div className="text-xs text-muted-foreground">{displayTarget(field)}</div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {field.required ? "Required" : "Optional"}
                    {field.multi_value ? " • Multi-value" : " • Single value"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => onEdit(index)}>
                        <Pencil className="h-4 w-4" />
                        Edit
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => onRemove(index)}>
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </TableRoot>
        </div>
      )}
    </Card>
  );
}

export function ManagedAgentEditor({ mode, managedAgentKey }: ManagedAgentEditorProps) {
  const router = useRouter();
  const [draft, setDraft] = useState<ManagedAgentUpsertRequest>(createEmptyDraft());
  const [catalog, setCatalog] = useState<ManagedAgentEditorCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [inputNameTouched, setInputNameTouched] = useState(mode === "edit");
  const [outputNameTouched, setOutputNameTouched] = useState(mode === "edit");
  const [fieldEditorErrors, setFieldEditorErrors] = useState<Record<string, string>>({});
  const [fieldEditor, setFieldEditor] = useState<FieldEditorState>({
    open: false,
    section: "input",
    index: null,
    draft: createEmptyField(),
  });

  useEffect(() => {
    let active = true;
    setLoading(true);

    Promise.all([
      getManagedAgentEditorCatalog(),
      mode === "edit" && managedAgentKey ? getManagedAgent(managedAgentKey) : Promise.resolve(null),
    ])
      .then(([editorCatalog, detail]) => {
        if (!active) {
          return;
        }
        setCatalog(editorCatalog);
        setDraft(detail ? toDraft(detail) : createEmptyDraft());
        setError(null);
        setValidationErrors({});
        setInputNameTouched(mode === "edit");
        setOutputNameTouched(mode === "edit");
      })
      .catch((cause) => {
        if (!active) {
          return;
        }
        setCatalog(null);
        setError(cause instanceof Error ? cause.message : "Failed to load managed-agent editor");
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [managedAgentKey, mode]);

  useEffect(() => {
    if (mode !== "create") {
      return;
    }
    const baseName = draft.name.trim();

    setDraft((current) => {
      let changed = false;
      const next = { ...current };

      if (!inputNameTouched) {
        const nextInputName = baseName ? `${baseName} Request` : "";
        if (next.input_name !== nextInputName) {
          next.input_name = nextInputName;
          changed = true;
        }
      }

      if (!outputNameTouched) {
        const nextOutputName = baseName ? `${baseName} Result` : "";
        if (next.output_name !== nextOutputName) {
          next.output_name = nextOutputName;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [draft.name, inputNameTouched, mode, outputNameTouched]);

  const valueTypeOptions = useMemo(
    () =>
      (catalog?.value_types || []).map((item) => ({
        value: item.iri,
        label: item.label || item.iri,
        description: item.kind,
      })),
    [catalog]
  );
  const objectModelOptions = useMemo(
    () =>
      (catalog?.object_models || []).map((item) => ({
        value: item.iri,
        label: item.label || item.iri,
        description: item.kind,
      })),
    [catalog]
  );

  const valueTypeLabels = useMemo(
    () => new Map((catalog?.value_types || []).map((item) => [item.iri, item.label || item.iri])),
    [catalog]
  );
  const objectModelLabels = useMemo(
    () => new Map((catalog?.object_models || []).map((item) => [item.iri, item.label || item.iri])),
    [catalog]
  );

  const previewActionUri = draft.managed_agent_key.trim()
    ? `urn:seer:managed-agent:${draft.managed_agent_key.trim()}`
    : "urn:seer:managed-agent:{managed_agent_key}";
  const previewInputUri = `${previewActionUri}:input`;
  const previewOutputUri = `${previewActionUri}:output`;

  const openFieldEditor = (section: SchemaSection, index?: number) => {
    const sourceFields = section === "input" ? draft.input_fields : draft.output_fields;
    setFieldEditorErrors({});
    setFieldEditor({
      open: true,
      section,
      index: typeof index === "number" ? index : null,
      draft:
        typeof index === "number"
          ? { ...sourceFields[index] }
          : createEmptyField(),
    });
  };

  const closeFieldEditor = () => {
    setFieldEditorErrors({});
    setFieldEditor((current) => ({ ...current, open: false }));
  };

  const saveFieldEditor = () => {
    const normalizedField = normalizeField(fieldEditor.draft);
    const errors = validateField(normalizedField);
    if (Object.keys(errors).length > 0) {
      setFieldEditorErrors(errors);
      return;
    }

    setDraft((current) => {
      const next = {
        ...current,
        input_fields: [...current.input_fields],
        output_fields: [...current.output_fields],
      };
      const targetFields =
        fieldEditor.section === "input" ? next.input_fields : next.output_fields;

      if (fieldEditor.index === null) {
        targetFields.push(normalizedField);
      } else {
        targetFields[fieldEditor.index] = normalizedField;
      }

      return next;
    });

    closeFieldEditor();
  };

  const removeField = (section: SchemaSection, index: number) => {
    setDraft((current) => {
      const key = section === "input" ? "input_fields" : "output_fields";
      return {
        ...current,
        [key]: current[key].filter((_, fieldIndex) => fieldIndex !== index),
      };
    });
  };

  const submit = async () => {
    const normalized = normalizeDraft(draft);
    const nextErrors = validateDraft(normalized);
    if (Object.keys(nextErrors).length > 0) {
      setValidationErrors(nextErrors);
      setDraft(normalized);
      return;
    }

    setSaving(true);
    setValidationErrors({});
    setError(null);

    try {
      const response =
        mode === "create"
          ? await createManagedAgent(normalized)
          : await updateManagedAgent(normalized.managed_agent_key, normalized);

      toast.success(
        mode === "create" ? "Managed agent created." : "Managed agent updated."
      );

      startTransition(() => {
        router.push(buildManagedAgentHref(response.managed_agent_key));
      });
    } catch (cause) {
      const requestError = cause as Partial<ManagedAgentRequestError>;
      const detail = requestError.detail;
      if (detail && typeof detail === "object" && !Array.isArray(detail)) {
        const nextFieldErrors: Record<string, string> = {};
        if (typeof detail.field === "string" && typeof detail.message === "string") {
          nextFieldErrors[detail.field] = detail.message;
        }
        if (typeof detail.message === "string") {
          setError(detail.message);
        } else {
          setError(cause instanceof Error ? cause.message : "Failed to save managed agent");
        }
        setValidationErrors(nextFieldErrors);
      } else {
        setError(cause instanceof Error ? cause.message : "Failed to save managed agent");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">
        Loading managed-agent editor...
      </Card>
    );
  }

  if (error && !catalog) {
    return (
      <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-8 text-sm text-destructive">
        {error}
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-managed-agent-editor={mode}>
      <div className="sticky top-4 z-10 rounded-2xl border border-border bg-background/95 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {mode === "create" ? "New Managed Agent" : "Edit Managed Agent"}
            </div>
            <p className="text-sm text-muted-foreground">
              Define the agent basics, instruction, input contract, and output event shape in one
              place. Save makes the change live immediately in `seer_data`.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link
                href={
                  mode === "edit" && managedAgentKey
                    ? buildManagedAgentHref(managedAgentKey)
                    : buildManagedAgentsIndexHref()
                }
              >
                <ArrowLeft className="h-4 w-4" />
                Cancel
              </Link>
            </Button>
            <Button type="button" onClick={() => void submit()} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : mode === "create" ? "Create Managed Agent" : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <Card className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Basics
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="managed-agent-name" className="text-sm font-medium">
                Name
              </label>
              <Input
                id="managed-agent-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Ticket Triage Assistant"
              />
              <ErrorText message={validationErrors.name} />
            </div>

            <div className="space-y-2">
              <label htmlFor="managed-agent-key" className="text-sm font-medium">
                Machine key
              </label>
              <Input
                id="managed-agent-key"
                value={draft.managed_agent_key}
                disabled={mode === "edit"}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    managed_agent_key: event.target.value.toLowerCase(),
                  }))
                }
                placeholder="ticket_triage_assistant"
              />
              <p className="text-xs text-muted-foreground">
                This becomes the stable RDF identity suffix and route key.
              </p>
              <ErrorText message={validationErrors.managed_agent_key} />
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <label htmlFor="managed-agent-description" className="text-sm font-medium">
              Description
            </label>
            <Textarea
              id="managed-agent-description"
              value={draft.description || ""}
              onChange={(event) =>
                setDraft((current) => ({ ...current, description: event.target.value }))
              }
              placeholder="What the agent is responsible for and when operators should use it."
              className="min-h-24"
            />
          </div>

          <div className="mt-4 space-y-2">
            <span className="text-sm font-medium">Availability</span>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={draft.enabled ? "default" : "outline"}
                onClick={() => setDraft((current) => ({ ...current, enabled: true }))}
              >
                Enabled
              </Button>
              <Button
                type="button"
                variant={!draft.enabled ? "default" : "outline"}
                onClick={() => setDraft((current) => ({ ...current, enabled: false }))}
              >
                Disabled
              </Button>
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Generated Preview
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            This is the managed-agent identity the editor will persist into `seer_data`.
          </p>

          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Action URI
              </div>
              <div className="mt-2 break-all text-sm">{previewActionUri}</div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Input URI
              </div>
              <div className="mt-2 break-all text-sm">{previewInputUri}</div>
            </div>
            <div className="rounded-2xl border border-border/70 bg-muted/15 p-4">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Output event URI
              </div>
              <div className="mt-2 break-all text-sm">{previewOutputUri}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Instruction
        </div>
        <div className="mt-5 space-y-2">
          <label htmlFor="managed-agent-instruction" className="text-sm font-medium">
            Operating instruction
          </label>
          <Textarea
            id="managed-agent-instruction"
            value={draft.instruction}
            onChange={(event) =>
              setDraft((current) => ({ ...current, instruction: event.target.value }))
            }
            placeholder="Explain how the managed agent should reason, what evidence to inspect, and what constraints to honor."
            className="min-h-48"
          />
          <ErrorText message={validationErrors.instruction} />
        </div>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Input Definition
          </div>
          <div className="mt-5 grid gap-4">
            <div className="space-y-2">
              <label htmlFor="managed-agent-input-name" className="text-sm font-medium">
                Input name
              </label>
              <Input
                id="managed-agent-input-name"
                value={draft.input_name}
                onChange={(event) => {
                  setInputNameTouched(true);
                  setDraft((current) => ({ ...current, input_name: event.target.value }));
                }}
              />
              <ErrorText message={validationErrors.input_name} />
            </div>
            <div className="space-y-2">
              <label htmlFor="managed-agent-input-description" className="text-sm font-medium">
                Input description
              </label>
              <Textarea
                id="managed-agent-input-description"
                value={draft.input_description || ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, input_description: event.target.value }))
                }
                className="min-h-24"
              />
            </div>
          </div>
        </Card>

        <Card className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Output Event Definition
          </div>
          <div className="mt-5 grid gap-4">
            <div className="space-y-2">
              <label htmlFor="managed-agent-output-name" className="text-sm font-medium">
                Output event name
              </label>
              <Input
                id="managed-agent-output-name"
                value={draft.output_name}
                onChange={(event) => {
                  setOutputNameTouched(true);
                  setDraft((current) => ({ ...current, output_name: event.target.value }));
                }}
              />
              <ErrorText message={validationErrors.output_name} />
            </div>
            <div className="space-y-2">
              <label htmlFor="managed-agent-output-description" className="text-sm font-medium">
                Output description
              </label>
              <Textarea
                id="managed-agent-output-description"
                value={draft.output_description || ""}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, output_description: event.target.value }))
                }
                className="min-h-24"
              />
            </div>
          </div>
        </Card>
      </div>

      <SchemaFieldsTable
        title="Input Schema"
        description="Add the fields an operator or calling system must provide when starting a managed-agent run."
        fields={draft.input_fields}
        onAdd={() => openFieldEditor("input")}
        onEdit={(index) => openFieldEditor("input", index)}
        onRemove={(index) => removeField("input", index)}
        valueTypeLabels={valueTypeLabels}
        objectModelLabels={objectModelLabels}
      />
      <ErrorText message={validationErrors.input_fields} />

      <SchemaFieldsTable
        title="Output Event Schema"
        description="Add the fields this managed agent will emit in its canonical output event."
        fields={draft.output_fields}
        onAdd={() => openFieldEditor("output")}
        onEdit={(index) => openFieldEditor("output", index)}
        onRemove={(index) => removeField("output", index)}
        valueTypeLabels={valueTypeLabels}
        objectModelLabels={objectModelLabels}
      />
      <ErrorText message={validationErrors.output_fields} />

      <Dialog open={fieldEditor.open} onOpenChange={(open) => (!open ? closeFieldEditor() : null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {fieldEditor.index === null ? "Add field" : "Edit field"}
            </DialogTitle>
            <DialogDescription>
              Configure one {fieldEditor.section} field at a time. The editor maps this directly to
              a Prophet property definition.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="field-label" className="text-sm font-medium">
                  Label
                </label>
                <Input
                  id="field-label"
                  value={fieldEditor.draft.label}
                  onChange={(event) =>
                    setFieldEditor((current) => ({
                      ...current,
                      draft: { ...current.draft, label: event.target.value },
                    }))
                  }
                />
                <ErrorText message={fieldEditorErrors.label} />
              </div>

              <div className="space-y-2">
                <label htmlFor="field-key" className="text-sm font-medium">
                  Field key
                </label>
                <Input
                  id="field-key"
                  value={fieldEditor.draft.field_key}
                  onChange={(event) =>
                    setFieldEditor((current) => ({
                      ...current,
                      draft: {
                        ...current.draft,
                        field_key: event.target.value,
                      },
                    }))
                  }
                />
                <ErrorText message={fieldEditorErrors.field_key} />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="field-description" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="field-description"
                value={fieldEditor.draft.description || ""}
                onChange={(event) =>
                  setFieldEditor((current) => ({
                    ...current,
                    draft: { ...current.draft, description: event.target.value },
                  }))
                }
                className="min-h-24"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label htmlFor="field-type" className="text-sm font-medium">
                  Field type
                </label>
                <Select
                  value={fieldEditor.draft.field_type}
                  onValueChange={(value) =>
                    setFieldEditor((current) => ({
                      ...current,
                      draft: {
                        ...current.draft,
                        field_type: value as ManagedAgentFieldDefinition["field_type"],
                        value_type_iri:
                          value === "value_type" ? current.draft.value_type_iri : null,
                        object_model_iri:
                          value === "object_reference" ? current.draft.object_model_iri : null,
                      },
                    }))
                  }
                >
                  <SelectTrigger id="field-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="value_type">Value type</SelectItem>
                    <SelectItem value="object_reference">Object reference</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Cardinality</label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={fieldEditor.draft.required ? "default" : "outline"}
                    onClick={() =>
                      setFieldEditor((current) => ({
                        ...current,
                        draft: { ...current.draft, required: !current.draft.required },
                      }))
                    }
                  >
                    {fieldEditor.draft.required ? "Required" : "Optional"}
                  </Button>
                  <Button
                    type="button"
                    variant={fieldEditor.draft.multi_value ? "default" : "outline"}
                    onClick={() =>
                      setFieldEditor((current) => ({
                        ...current,
                        draft: { ...current.draft, multi_value: !current.draft.multi_value },
                      }))
                    }
                  >
                    {fieldEditor.draft.multi_value ? "Multi-value" : "Single value"}
                  </Button>
                </div>
              </div>
            </div>

            {fieldEditor.draft.field_type === "value_type" ? (
              <div className="space-y-2">
                <label htmlFor="field-value-type" className="text-sm font-medium">
                  Value type
                </label>
                <SearchableSelect
                  triggerId="field-value-type"
                  value={fieldEditor.draft.value_type_iri || EMPTY_SELECT_VALUE}
                  onValueChange={(value) =>
                    setFieldEditor((current) => ({
                      ...current,
                      draft: {
                        ...current.draft,
                        value_type_iri: value === EMPTY_SELECT_VALUE ? null : value,
                      },
                    }))
                  }
                  groups={[
                    {
                      label: "Value types",
                      options: [
                        { value: EMPTY_SELECT_VALUE, label: "Select value type" },
                        ...valueTypeOptions,
                      ],
                    },
                  ]}
                  placeholder="Select value type"
                  searchPlaceholder="Search value types..."
                  emptyMessage="No value types found."
                />
                <ErrorText message={fieldEditorErrors.value_type_iri} />
              </div>
            ) : (
              <div className="space-y-2">
                <label htmlFor="field-object-model" className="text-sm font-medium">
                  Object model
                </label>
                <SearchableSelect
                  triggerId="field-object-model"
                  value={fieldEditor.draft.object_model_iri || EMPTY_SELECT_VALUE}
                  onValueChange={(value) =>
                    setFieldEditor((current) => ({
                      ...current,
                      draft: {
                        ...current.draft,
                        object_model_iri: value === EMPTY_SELECT_VALUE ? null : value,
                      },
                    }))
                  }
                  groups={[
                    {
                      label: "Object models",
                      options: [
                        { value: EMPTY_SELECT_VALUE, label: "Select object model" },
                        ...objectModelOptions,
                      ],
                    },
                  ]}
                  placeholder="Select object model"
                  searchPlaceholder="Search object models..."
                  emptyMessage="No object models found."
                />
                <ErrorText message={fieldEditorErrors.object_model_iri} />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeFieldEditor}>
              Cancel
            </Button>
            <Button type="button" onClick={saveFieldEditor}>
              Save Field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
