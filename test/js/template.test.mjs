import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import { loadComponent } from "./load.mjs";
import { i18n } from "./stubs/i18n.mjs";
import { escapeExpression as esc } from "./stubs/utilities.mjs";
import { applySettings, makeNote, TAG } from "./fixtures.mjs";

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
  solution: false,
  solutionHere: true,
  syncSolution: false,
  hidden: false,
  downNote: null,
  canNote: true,
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
        state({
          liked: true,
          solution: true,
          syncSolution: true,
          hidden: true,
          downNote: makeNote(TAG.down),
        }),
        mode,
        "a notice"
      );
      assert.doesNotMatch(html, /\[missing/, `mode=${mode}`);
    }
  });

  it("marks thumbs up active once the reply is the solution", () => {
    assert.match(template(state({ solution: true }), null), /js-up is-active/);
    assert.match(template(state({ liked: true }), null), /js-up is-active/);
    assert.doesNotMatch(template(state(), null), /js-up is-active/);
  });

  it("marks needs-work active once a note of yours exists", () => {
    assert.match(template(state({ downNote: makeNote(TAG.down) }), null), /js-down is-active/);
    assert.doesNotMatch(template(state(), null), /js-down is-active/);
  });

  it("flips the review button to put-back once the reply is gone", () => {
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
    for (const mode of ["up", "down", "review"]) {
      assert.match(t(`hint.${mode}`), /optional/i, mode);
    }
  });

  it("says where the note goes and what the action does", () => {
    assert.match(t("hint.up"), /whisper/i);
    assert.match(t("hint.down"), /whisper/i);
    assert.match(t("hint.down"), /members never see/i);
    assert.match(t("hint.review"), /except moderators/i);
    assert.match(t("hint.review"), /put it back/i);
  });
});

describe("solutions", () => {
  it("says nothing about them when the Solved plugin is not there", () => {
    assert.doesNotMatch(template(state({ syncSolution: false }), "up"), /solution/i);
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
    const html = template(state({ hidden: true, downNote: makeNote(TAG.down) }), null);

    assert.ok(html.includes(et("status.hidden")));
    assert.ok(html.includes(et("status.flagged")));
  });

  it("does not repeat itself when the like is part of the solution", () => {
    const html = template(state({ liked: true, solution: true }), null);

    assert.ok(html.includes(et("status.solution")));
    assert.ok(!html.includes(et("status.liked")));
  });

  it("shows a notice above everything else", () => {
    const html = template(state({ hidden: true }), null, "something went wrong");

    assert.match(html, /js-notice/);
    assert.ok(html.indexOf("js-notice") < html.indexOf("is-review"));
  });

  it("escapes a notice rather than trusting it", () => {
    const html = template(state(), null, '<img src=x onerror="alert(1)">');

    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  it("stays quiet when nothing has happened", () => {
    assert.doesNotMatch(template(state(), null), /bot-eval-status/);
  });
});
