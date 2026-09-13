// Stub for discourse/lib/api. Captures the callback the plugin registers so a
// test can drive the decorator directly.
export function apiInitializer(version, callback) {
  const actual = typeof version === "function" ? version : callback;
  return { version: typeof version === "function" ? null : version, initialize: actual };
}
