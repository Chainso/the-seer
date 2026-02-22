export type DependencyStatus = {
  host: string;
  port: number;
  reachable: boolean;
};

export type BackendHealth = {
  status: "ok" | "degraded";
  service: string;
  environment: string;
  dependencies: {
    fuseki: DependencyStatus;
    clickhouse: DependencyStatus;
  };
};

const DEFAULT_BACKEND_URL =
  process.env.SEER_BACKEND_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8000";

export async function getBackendHealth(): Promise<{
  data: BackendHealth | null;
  httpStatus: number | null;
  error: string | null;
}> {
  try {
    const response = await fetch(`${DEFAULT_BACKEND_URL}/api/v1/health`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        data: null,
        httpStatus: response.status,
        error: `Backend returned HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as BackendHealth;
    return { data, httpStatus: response.status, error: null };
  } catch (error) {
    return {
      data: null,
      httpStatus: null,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
