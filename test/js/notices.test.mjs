import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./load.mjs";
import { i18n } from "./stubs/i18n.mjs";
import * as ajaxStub from "./stubs/ajax.mjs";
import * as errorStub from "./stubs/ajax-error.mjs";
import { applySettings, makePost, makeCtx, LIKE, TAG } from "./fixtures.mjs";

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
const call = (url) => ajaxStub.calls.find((c) => c.url === url);
const failing = (prefix) => (url) =>
  url.startsWith(prefix) ? Promise.reject(new Error("nope")) : Promise.resolve({});

describe("when notes cannot be written at all", () => {
  it("offers the box to a moderator on a forum with whispers", () => {
    const { bar } = mount();
    $(bar, ".js-up").click();
    assert.ok($(bar, ".bot-eval-form"));
  });

  it("offers it when the version no longer exposes the whispers setting", () => {
    const { bar } = mount({ whispers: undefined });
    $(bar, ".js-up").click();
    assert.ok($(bar, ".bot-eval-form"), "an absent setting is not a 'no'");
  });

  it("skips the box on a thumbs up when whispers are off", async () => {
    const { bar, post } = mount({ whispers: false });

    $(bar, ".js-up").click();
    await settle();

    assert.equal($(bar, ".bot-eval-form"), null);
    assert.equal(post.accepted_answer, true, "the solution is still marked");
  });

  it("skips the box for somebody who is not staff", () => {
    const { bar } = mount({ staff: false });

    $(bar, ".js-up").click();

    assert.equal($(bar, ".bot-eval-form"), null);
  });

  it("says so rather than silently losing a needs-work reason", async () => {
    const { bar } = mount({ whispers: false });

    $(bar, ".js-down").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(notice(bar), i18n("bot_eval.notice.note_required_off"));
    assert.equal(call("/posts"), undefined);
  });
});

describe("when a step fails", () => {
  it("keeps the solution and says the note could not be saved", async () => {
    ajaxStub.setHandler(failing("/posts"));
    const { bar, post } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-text").value = "good answer";
    $(bar, ".js-save").click();
    await settle();

    assert.equal(post.accepted_answer, true);
    assert.match(notice(bar), /could not be saved/i);
    assert.deepEqual(errorStub.errors, [], "no error popup: the main action worked");
  });

  it("keeps the like and says the solution could not be changed", async () => {
    ajaxStub.setHandler(failing("/solution"));
    const { bar, post } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(post.actions_summary.find((a) => a.id === LIKE).acted, true);
    assert.match(notice(bar), /solution could not be changed/i);
  });

  it("says nothing at all when everything worked", async () => {
    const { bar } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-text").value = "good answer";
    $(bar, ".js-save").click();
    await settle();

    assert.equal(notice(bar), null);
  });

  it("explains a failed undo instead of leaving a dead button", async () => {
    ajaxStub.setHandler(() => Promise.reject(new Error("gone")));
    const { bar } = mount(
      {},
      makePost({}, [
        { id: 901, post_type: 4, user_id: 1, reply_to_post_number: 3, raw: `${TAG.down} x` },
      ])
    );

    $(bar, ".js-down").click();
    await settle();

    assert.match(notice(bar), /could not be undone/i);
  });
});
