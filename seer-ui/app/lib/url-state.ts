type SearchParamsLike = {
  toString(): string;
};

type SearchParamValue = string | string[] | null | undefined;

export function mergeSearchParams(
  current: SearchParamsLike,
  updates: Record<string, SearchParamValue>
): string {
  const next = new URLSearchParams(current.toString());

  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === "") {
      next.delete(key);
      return;
    }
    if (Array.isArray(value)) {
      next.delete(key);
      value
        .filter((item) => item !== "")
        .forEach((item) => {
          next.append(key, item);
        });
      return;
    }
    next.set(key, value);
  });

  return next.toString();
}

export function parseBooleanSearchParam(value: string | null | undefined, fallback = false): boolean {
  if (value === null || value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") {
    return true;
  }
  if (normalized === "0" || normalized === "false") {
    return false;
  }
  return fallback;
}
