const BIGINT_ZERO = BigInt(0);
const BIGINT_29 = BigInt(29);
const BIGINT_32 = BigInt(32);
const BIGINT_33 = BigInt(33);
const BIGINT_64 = BigInt(64);

const MASK_64 = BigInt("18446744073709551615");
const PRIME64_1 = BigInt("11400714785074694791");
const PRIME64_2 = BigInt("14029467366897019727");
const PRIME64_3 = BigInt("1609587929392839161");
const PRIME64_4 = BigInt("9650029242287828579");
const PRIME64_5 = BigInt("2870177450012600261");

function toUint64(value: bigint): bigint {
  return value & MASK_64;
}

function rotl64(value: bigint, bits: number): bigint {
  const shift = BigInt(bits);
  return toUint64((value << shift) | (value >> (BIGINT_64 - shift)));
}

function round64(acc: bigint, input: bigint): bigint {
  const sum = toUint64(acc + toUint64(input * PRIME64_2));
  return toUint64(rotl64(sum, 31) * PRIME64_1);
}

function mergeRound64(acc: bigint, value: bigint): bigint {
  const mixed = toUint64(acc ^ round64(BIGINT_ZERO, value));
  return toUint64(toUint64(mixed * PRIME64_1) + PRIME64_4);
}

function readUint64LE(view: DataView, offset: number): bigint {
  const low = BigInt(view.getUint32(offset, true));
  const high = BigInt(view.getUint32(offset + 4, true));
  return (high << BIGINT_32) | low;
}

function readUint32LE(view: DataView, offset: number): bigint {
  return BigInt(view.getUint32(offset, true));
}

export function xxhash64Uint64(text: string): string {
  const buffer = new TextEncoder().encode(text);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const length = buffer.length;
  let offset = 0;

  let hash: bigint;

  if (length >= 32) {
    let v1 = toUint64(PRIME64_1 + PRIME64_2);
    let v2 = PRIME64_2;
    let v3 = BIGINT_ZERO;
    let v4 = toUint64(BIGINT_ZERO - PRIME64_1);

    const limit = length - 32;
    while (offset <= limit) {
      v1 = round64(v1, readUint64LE(view, offset));
      offset += 8;
      v2 = round64(v2, readUint64LE(view, offset));
      offset += 8;
      v3 = round64(v3, readUint64LE(view, offset));
      offset += 8;
      v4 = round64(v4, readUint64LE(view, offset));
      offset += 8;
    }

    hash = toUint64(rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18));
    hash = mergeRound64(hash, v1);
    hash = mergeRound64(hash, v2);
    hash = mergeRound64(hash, v3);
    hash = mergeRound64(hash, v4);
  } else {
    hash = PRIME64_5;
  }

  hash = toUint64(hash + BigInt(length));

  while (offset + 8 <= length) {
    const lane = round64(BIGINT_ZERO, readUint64LE(view, offset));
    hash = toUint64(hash ^ lane);
    hash = toUint64(toUint64(rotl64(hash, 27) * PRIME64_1) + PRIME64_4);
    offset += 8;
  }

  while (offset + 4 <= length) {
    hash = toUint64(hash ^ toUint64(readUint32LE(view, offset) * PRIME64_1));
    hash = toUint64(toUint64(rotl64(hash, 23) * PRIME64_2) + PRIME64_3);
    offset += 4;
  }

  while (offset < length) {
    hash = toUint64(hash ^ toUint64(BigInt(buffer[offset]) * PRIME64_5));
    hash = toUint64(rotl64(hash, 11) * PRIME64_1);
    offset += 1;
  }

  hash = toUint64(hash ^ (hash >> BIGINT_33));
  hash = toUint64(hash * PRIME64_2);
  hash = toUint64(hash ^ (hash >> BIGINT_29));
  hash = toUint64(hash * PRIME64_3);
  hash = toUint64(hash ^ (hash >> BIGINT_32));

  return hash.toString(10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyCanonical(value: unknown): string {
  if (value === null) {
    return "null";
  }

  const valueType = typeof value;
  if (valueType === "string") {
    return JSON.stringify(value);
  }
  if (valueType === "boolean") {
    return value ? "true" : "false";
  }
  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Object ref contains a non-finite number.");
    }
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stringifyCanonical(item)).join(",")}]`;
  }

  if (!isRecord(value)) {
    throw new Error("Object ref contains an unsupported value.");
  }

  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stringifyCanonical(value[key])}`);
  return `{${entries.join(",")}}`;
}

export function canonicalizeObjectRefInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Object reference is required.");
  }

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return trimmed;
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return stringifyCanonical(parsed);
  } catch {
    return trimmed;
  }
}

export function resolveObjectRefHash(params: {
  object_ref_hash?: string;
  object_ref?: string;
}): { object_ref_hash: string; object_ref_canonical: string | null } {
  const explicitHash = params.object_ref_hash?.trim() ?? "";
  if (explicitHash) {
    if (!/^\d+$/.test(explicitHash)) {
      throw new Error("Object ref hash must be an unsigned integer.");
    }
    return { object_ref_hash: explicitHash, object_ref_canonical: null };
  }

  const objectRef = params.object_ref?.trim() ?? "";
  if (!objectRef) {
    throw new Error("Provide object ref hash or canonical object ref.");
  }

  if (/^\d+$/.test(objectRef)) {
    return { object_ref_hash: objectRef, object_ref_canonical: null };
  }

  const canonical = canonicalizeObjectRefInput(objectRef);
  return {
    object_ref_hash: xxhash64Uint64(canonical),
    object_ref_canonical: canonical,
  };
}
