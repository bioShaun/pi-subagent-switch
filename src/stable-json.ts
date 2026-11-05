/** 键递归排序后 JSON 序列化；对象中值为 undefined 的键被丢弃；数组顺序保持不变。 */
export function stableStringify(value: unknown): string {
  const sorted = sortValue(value);
  const result = JSON.stringify(sorted);
  return result === undefined ? "null" : result;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortValue(item));
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // 用无原型对象累积排序键：普通 {} 会把 JSON.parse 产生的自有 "__proto__" 键
    // 当成原型 setter 而丢弃，导致含该键的档与不含该键的档序列化结果相等。
    const out = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue;
      out[key] = sortValue(obj[key]);
    }
    return out;
  }
  return value;
}
