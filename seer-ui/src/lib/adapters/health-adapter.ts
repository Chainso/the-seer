import type { BackendHealth } from "@/lib/backend-health";
import { buildViewModelMeta, type ViewModelMeta } from "@/lib/adapters/common";

export type HealthDependencyViewModel = {
  name: string;
  target: string;
  reachable: boolean;
};

export type HealthPanelViewModel = {
  service: string;
  status: BackendHealth["status"];
  environment: string;
  dependencies: HealthDependencyViewModel[];
  meta: ViewModelMeta;
};

export function adaptBackendHealth(dto: BackendHealth): HealthPanelViewModel {
  return {
    service: dto.service,
    status: dto.status,
    environment: dto.environment,
    dependencies: [
      {
        name: "Fuseki",
        target: `${dto.dependencies.fuseki.host}:${dto.dependencies.fuseki.port}`,
        reachable: dto.dependencies.fuseki.reachable,
      },
      {
        name: "ClickHouse",
        target: `${dto.dependencies.clickhouse.host}:${dto.dependencies.clickhouse.port}`,
        reachable: dto.dependencies.clickhouse.reachable,
      },
    ],
    meta: buildViewModelMeta(),
  };
}
