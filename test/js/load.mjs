// Loads the component's real source with Discourse's bare module specifiers
// rewritten to the stubs in ./stubs, so the shipped file is what runs.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "../../javascripts/discourse/api-initializers/bot-eval.js");
const GENERATED = path.join(here, "component.generated.mjs");

const REWRITES = {
  "discourse/lib/api": "./stubs/api.mjs",
  "discourse/lib/ajax": "./stubs/ajax.mjs",
  "discourse/lib/ajax-error": "./stubs/ajax-error.mjs",
  "discourse/lib/utilities": "./stubs/utilities.mjs",
  "discourse-i18n": "./stubs/i18n.mjs",
};

export function loadComponent() {
  let code = fs.readFileSync(SOURCE, "utf8");
  for (const [from, to] of Object.entries(REWRITES)) {
    code = code.split(`"${from}"`).join(`"${to}"`);
  }
  fs.writeFileSync(GENERATED, code);
  return import(url.pathToFileURL(GENERATED).href);
}
