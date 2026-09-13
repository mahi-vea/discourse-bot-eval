import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import { loadComponent } from "./load.mjs";
import { i18n } from "./stubs/i18n.mjs";
import { escapeExpression as esc } from "./stubs/utilities.mjs";
import { applySettings } from "./fixtures.mjs";

let template;

before(async () => {
  applySettings();
  ({ template } = await loadComponent());
});

beforeEach(() => applySettings());

const t = (key, opts) => i18n(`bot_eval.${key}`, opts);
const et = (key, opts) => esc(t(key, opts));

const state = (overrides = {}) => ({
  liked: false,
  flagged: false,
  hidden: false,
  solution: false,
  syncSolution: false,
  noteOnGood: true,
  ...overrides,
});

describe("the bar", () => {
  it("offers all three actions", () => {
    const html = template(state(), null);

    assert.match(html, /js-up/);
    assert.match(html, /js-down/);
    assert.match(html, /js-review/);
  });

  it("never leaks a missing translation", () => {
    for (const mode of [null, "up", "down", "review"]) {
      const html = template(
        state({ liked: true, flagged: true, hidden: true, solution: true, syncSolution: true }),
        mode
      );
      assert.doesNotMatch(html, /\[missing/, `mode=${mode}`);
    }
  });

  it("marks each action active from Discourse's own state", () => {
    assert.match(template(state({ liked: true }), null), /js-up is-active/);
    assert.match(template(state({ flagged: true }), null), /js-down is-active/);
    assert.match(template(state({ hidden: true }), null), /js-review is-active/);
    assert.doesNotMatch(template(state(), null), /is-active/);
  });

  it("flips the review button to un-hide once the reply is hidden", () => {
    const html = template(state({ hidden: true }), null);

    assert.ok(html.includes(et("unmark_review")));
    assert.match(html, /d-icon-eye /);
  });
});

describe("the note box", () => {
  it("is absent until an action asks for it", () => {
    assert.doesNotMatch(template(state(), null), /bot-eval-form/);
  });

  it("carries the hint and placeholder for its mode, hint first", () => {
    for (const mode of ["up", "down", "review"]) {
      const html = template(state(), mode);

      assert.ok(html.includes(et(`hint.${mode}`)), `hint for ${mode}`);
      assert.ok(html.includes(et(`placeholder.${mode}`)), `placeholder for ${mode}`);
      assert.ok(html.indexOf("bot-eval-hint") < html.indexOf("<textarea"));
    }
  });

  it("tells the evaluator the note is optional everywhere", () => {
    assert.match(t("hint.up"), /optional/i);
    assert.match(t("hint.down"), /optional/i);
    assert.match(t("hint.review"), /optional/i);
  });

  it("says where a note actually goes", () => {
    assert.match(t("hint.up"), /whisper/i);
    assert.match(t("hint.down"), /review queue/i);
    assert.match(t("hint.review"), /review queue/i);
  });
});

describe("solutions", () => {
  it("says nothing about them when the Solved plugin is not there", () => {
    const html = template(state({ syncSolution: false }), "up");
    assert.doesNotMatch(html, /solution/i);
  });

  it("warns what each action will do when it is", () => {
    for (const mode of ["up", "down", "review"]) {
      const html = template(state({ syncSolution: true }), mode);
      assert.ok(html.includes(et(`hint_solution.${mode}`)), mode);
    }
  });

  it("shows a badge while the reply is the accepted solution", () => {
    assert.match(template(state({ solution: true }), null), /is-solution/);
    assert.doesNotMatch(template(state(), null), /is-solution/);
  });
});

describe("status lines", () => {
  it("spells out what has already happened to the reply", () => {
    const html = template(state({ liked: true, flagged: true, hidden: true }), null);

    assert.ok(html.includes(et("status.liked")));
    assert.ok(html.includes(et("status.flagged")));
    assert.ok(html.includes(et("status.hidden")));
  });

  it("stays quiet when nothing has happened", () => {
    assert.doesNotMatch(template(state(), null), /bot-eval-status/);
  });
});
