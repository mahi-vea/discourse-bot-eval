import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./load.mjs";
import { i18n } from "./stubs/i18n.mjs";
import * as ajaxStub from "./stubs/ajax.mjs";
import * as errorStub from "./stubs/ajax-error.mjs";
import { applySettings, makePost, makeCtx, LIKE } from "./fixtures.mjs";

let renderBar;

before(async () => {
  applySettings();
  ({ renderBar } = await loadComponent());
});

beforeEach(() => {
  applySettings();
  ajaxStub.reset();
  errorStub.reset();
});

function mount(ctxOverrides = {}, post = makePost()) {
  const dom = new JSDOM(`<article class="topic-post"><div class="cooked"></div></article>`);
  const bar = dom.window.document.createElement("div");
  bar.className = "bot-eval-bar";
  dom.window.document.querySelector(".cooked").appendChild(bar);
  renderBar(bar, post, makeCtx(ctxOverrides));
  return { bar, post };
}

const $ = (bar, sel) => bar.querySelector(sel);
const settle = () => new Promise((r) => setTimeout(r, 0));
const notice = (bar) => $(bar, ".js-notice")?.textContent?.trim() || null;
const failing = (prefix) => (url) =>
  url.startsWith(prefix) ? Promise.reject(new Error("nope")) : Promise.resolve({});

describe("the note box on a thumbs up is only offered when it has somewhere to go", () => {
  it("is offered to a moderator on a forum with whispers", () => {
    const { bar } = mount();
    $(bar, ".js-up").click();
    assert.ok($(bar, ".bot-eval-form"));
  });

  it("is offered when the version no longer exposes the whispers setting", () => {
    const { bar } = mount({ whispers: undefined });
    $(bar, ".js-up").click();
    assert.ok($(bar, ".bot-eval-form"), "an absent setting is not a 'no'");
  });

  it("is skipped when whispers are switched off", () => {
    const { bar } = mount({ whispers: false });

    $(bar, ".js-up").click();

    assert.equal($(bar, ".bot-eval-form"), null);
    assert.equal(ajaxStub.calls[0].url, "/post_actions", "it just likes the post");
  });

  it("is skipped for somebody who is not staff", () => {
    const { bar } = mount({ staff: false });

    $(bar, ".js-up").click();

    assert.equal($(bar, ".bot-eval-form"), null);
    assert.equal(ajaxStub.calls[0].url, "/post_actions");
  });

  it("is skipped when the admin turned the note off", () => {
    applySettings({ good_note_as_whisper: false });
    const { bar } = mount();

    $(bar, ".js-up").click();

    assert.equal($(bar, ".bot-eval-form"), null);
  });
});

describe("when a side errand fails", () => {
  it("keeps the like and says the note could not be whispered", async () => {
    ajaxStub.setHandler(failing("/posts"));
    const { bar, post } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-text").value = "good answer";
    $(bar, ".js-save").click();
    await settle();

    assert.equal(post.actions_summary.find((a) => a.id === LIKE).acted, true);
    assert.equal(notice(bar), i18n("bot_eval.notice.whisper_failed"));
    assert.deepEqual(errorStub.errors, [], "no error popup for a side errand");
  });

  it("keeps the like and says the solution could not be changed", async () => {
    ajaxStub.setHandler(failing("/solution"));
    const { bar, post } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(post.actions_summary.find((a) => a.id === LIKE).acted, true);
    assert.equal(notice(bar), i18n("bot_eval.notice.solution_failed"));
  });

  it("keeps the flag when the solution cannot be withdrawn", async () => {
    ajaxStub.setHandler(failing("/solution"));
    const { bar, post } = mount({}, makePost({ accepted_answer: true }));

    $(bar, ".js-down").click();
    $(bar, ".js-text").value = "wrong deadline";
    $(bar, ".js-save").click();
    await settle();

    assert.equal(notice(bar), i18n("bot_eval.notice.solution_failed"));
    assert.equal(post.accepted_answer, true, "and says so rather than pretending");
  });

  it("says nothing at all when everything worked", async () => {
    const { bar } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-text").value = "good answer";
    $(bar, ".js-save").click();
    await settle();

    assert.equal(notice(bar), null);
  });

  it("still reports a failure of the rating itself the usual way", async () => {
    ajaxStub.setHandler(failing("/post_actions"));
    const { bar } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(errorStub.errors.length, 1, "this one is not soft");
    assert.equal($(bar, ".js-save").disabled, false);
  });
});
