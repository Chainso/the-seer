"use client";

import type { ReactNode } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { SearchableSelect } from "../ui/searchable-select";

export type SharedWindowPreset = "24h" | "7d" | "30d" | "custom";

type ScopeModelOption = {
  value: string;
  label: string;
};

type InspectorScopeFiltersProps = {
  windowPreset: SharedWindowPreset;
  onApplyWindowPreset: (preset: Exclude<SharedWindowPreset, "custom">) => void;
  onCustomWindowChange: () => void;
  modelId: string;
  modelLabel: string;
  modelValue: string;
  modelValueLabel?: string;
  modelOptions: ScopeModelOption[];
  onModelChange: (value: string) => void;
  modelLocked?: boolean;
  modelLockedHelpText?: string;
  fromId: string;
  fromValue: string;
  onFromChange: (value: string) => void;
  toId: string;
  toValue: string;
  onToChange: (value: string) => void;
  runLabel: string;
  runningLabel: string;
  isRunning: boolean;
  runDisabled?: boolean;
  onRun: () => void;
  extraControl?: ReactNode;
};

export function InspectorScopeFilters({
  windowPreset,
  onApplyWindowPreset,
  onCustomWindowChange,
  modelId,
  modelLabel,
  modelValue,
  modelValueLabel,
  modelOptions,
  onModelChange,
  modelLocked = false,
  modelLockedHelpText,
  fromId,
  fromValue,
  onFromChange,
  toId,
  toValue,
  onToChange,
  runLabel,
  runningLabel,
  isRunning,
  runDisabled = false,
  onRun,
  extraControl,
}: InspectorScopeFiltersProps) {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={windowPreset === "24h" ? "secondary" : "outline"}
          onClick={() => onApplyWindowPreset("24h")}
        >
          Last 24h
        </Button>
        <Button
          type="button"
          size="sm"
          variant={windowPreset === "7d" ? "secondary" : "outline"}
          onClick={() => onApplyWindowPreset("7d")}
        >
          Last 7d
        </Button>
        <Button
          type="button"
          size="sm"
          variant={windowPreset === "30d" ? "secondary" : "outline"}
          onClick={() => onApplyWindowPreset("30d")}
        >
          Last 30d
        </Button>
      </div>

      <div
        className={`grid gap-4 ${
          extraControl ? "lg:grid-cols-[1.2fr_1fr_1fr_0.7fr_0.8fr]" : "lg:grid-cols-[1.2fr_1fr_1fr_0.8fr]"
        }`}
      >
        <div className="space-y-2">
          <Label htmlFor={modelId}>{modelLabel}</Label>
          {modelLocked ? (
            <div
              id={modelId}
              className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground"
            >
              <div className="font-medium">{modelValueLabel || modelValue || "—"}</div>
              {modelLockedHelpText ? (
                <div className="mt-1 text-xs text-muted-foreground">{modelLockedHelpText}</div>
              ) : null}
            </div>
          ) : (
            <SearchableSelect
              triggerId={modelId}
              value={modelValue}
              onValueChange={onModelChange}
              groups={[{ label: "Object models", options: modelOptions }]}
              placeholder="Select model"
              searchPlaceholder="Search models..."
            />
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor={fromId}>From</Label>
          <Input
            id={fromId}
            type="datetime-local"
            value={fromValue}
            onChange={(event) => {
              onCustomWindowChange();
              onFromChange(event.target.value);
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={toId}>To</Label>
          <Input
            id={toId}
            type="datetime-local"
            value={toValue}
            onChange={(event) => {
              onCustomWindowChange();
              onToChange(event.target.value);
            }}
          />
        </div>

        {extraControl}

        <div className="flex items-end">
          <Button className="w-full" onClick={onRun} disabled={runDisabled}>
            {isRunning ? runningLabel : runLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
