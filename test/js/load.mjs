// Loads the component's real source with Discourse's bare module specifiers
// rewritten to the stubs in ./stubs, so the shipped file is what runs.
//
// The rewritten source is imported as a data: URL rather than written to disk.
// Node runs test files in parallel, and a shared generated file would be a race
// between them - one process truncating it while another imports it.
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const SOURCE = path.resolve(here, "../../javascripts/discourse/api-initializers/bot-eval.js");

// Absolute, because a data: URL has no directory to resolve "./" against.
const stub = (name) => url.pathToFileURL(path.join(here, "stubs", name)).href;

const REWRITES = {
  "discourse/lib/api": stub("api.mjs"),
  "discourse/lib/ajax": stub("ajax.mjs"),
  "discourse/lib/ajax-error": stub("ajax-error.mjs"),
  "discourse/lib/utilities": stub("utilities.mjs"),
  "discourse-i18n": stub("i18n.mjs"),
};

export function loadComponent() {
  let code = fs.readFileSync(SOURCE, "utf8");
  for (const [from, to] of Object.entries(REWRITES)) {
    code = code.split(`"${from}"`).join(`"${to}"`);
  }
  return import(`data:text/javascript,${encodeURIComponent(code)}`);
}
