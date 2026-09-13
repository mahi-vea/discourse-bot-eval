// Stub for discourse-i18n, backed by the component's real locales/en.yml,
// regenerated on every run so it cannot drift from what ships.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const yamlPath = path.join(here, "..", "..", "..", "locales", "en.yml");
const jsonPath = path.join(here, "..", "locale.generated.json");

function build() {
  try {
    execFileSync("ruby", [
      "-ryaml",
      "-rjson",
      "-e",
      "File.write(ARGV[1], JSON.pretty_generate(YAML.load_file(ARGV[0])))",
      yamlPath,
      jsonPath,
    ]);
  } catch (e) {
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`cannot read ${yamlPath}: ${e.message}`);
    }
  }
  return JSON.parse(fs.readFileSync(jsonPath, "utf8")).en;
}

const translations = build();

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
