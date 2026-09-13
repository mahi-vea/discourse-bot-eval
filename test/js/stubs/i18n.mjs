// Stub for discourse-i18n, backed by the component's real locales/en.yml.
//
// The YAML is converted on every run so the fixture cannot drift from what
// ships. The conversion goes through stdout rather than a shared file: node
// runs test files in parallel, and a file would be a race between them.
// A key the locale file does not define comes back as `[missing "..."]`,
// which the tests assert never appears.
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const yamlPath = path.join(here, "..", "..", "..", "locales", "en.yml");

function load() {
  let out;
  try {
    out = execFileSync(
      "ruby",
      ["-ryaml", "-rjson", "-e", "print JSON.generate(YAML.load_file(ARGV[0]))", yamlPath],
      { encoding: "utf8" }
    );
  } catch (e) {
    throw new Error(`could not read ${yamlPath} (is ruby installed?): ${e.message}`);
  }
  return JSON.parse(out).en;
}

const translations = load();

export function i18n(key, opts = {}) {
  const value = key.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), translations);
  if (typeof value !== "string") {
    return `[missing "${key}"]`;
  }
  return value.replace(/%\{(\w+)\}/g, (m, name) =>
    Object.prototype.hasOwnProperty.call(opts, name) ? opts[name] : m
  );
}

export default { t: i18n };
