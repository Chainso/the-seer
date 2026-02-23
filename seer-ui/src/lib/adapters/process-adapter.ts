import type {
  ProcessMiningResponse,
  ProcessTraceDrilldownResponse,
} from "@/lib/backend-process";
import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";

export type ProcessRunViewModel = {
  run_id: string;
  window_label: string;
  object_types: string[];
  node_count: number;
  edge_count: number;
  warnings: string[];
  meta: ViewModelMeta;
};

export type ProcessTraceViewModel = {
  handle: string;
  selector_type: string;
  matched_count: number;
  truncated: boolean;
  trace_count: number;
  meta: ViewModelMeta;
};

export function adaptProcessRun(dto: ProcessMiningResponse): ProcessRunViewModel {
  return {
    run_id: dto.run_id,
    window_label: `${dto.start_at} to ${dto.end_at}`,
    object_types: dto.object_types,
    node_count: dto.nodes.length,
    edge_count: dto.edges.length,
    warnings: dto.warnings,
    meta: buildViewModelMeta(),
  };
}

export function adaptProcessTraceDrilldown(
  dto: ProcessTraceDrilldownResponse
): ProcessTraceViewModel {
  return {
    handle: dto.handle,
    selector_type: dto.selector_type,
    matched_count: dto.matched_count,
    truncated: dto.truncated,
    trace_count: dto.traces.length,
    meta: buildViewModelMeta(),
  };
}
