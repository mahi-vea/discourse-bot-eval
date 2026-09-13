import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./load.mjs";
import { i18n } from "./stubs/i18n.mjs";
import * as ajaxStub from "./stubs/ajax.mjs";
import * as errorStub from "./stubs/ajax-error.mjs";
import { applySettings, makePost, makeCtx, LIKE, NOTIFY_MODERATORS } from "./fixtures.mjs";

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

function mount(post = makePost(), ctxOverrides = {}) {
  const dom = new JSDOM(`<article class="topic-post"><div class="cooked"></div></article>`);
  const doc = dom.window.document;
  const bar = doc.createElement("div");
  bar.className = "bot-eval-bar";
  doc.querySelector(".cooked").appendChild(bar);
  renderBar(bar, post, makeCtx(ctxOverrides));
  return { bar, post, article: doc.querySelector("article") };
}

const $ = (bar, sel) => bar.querySelector(sel);
const type = (bar, text) => ($(bar, ".js-text").value = text);
const settle = () => new Promise((r) => setTimeout(r, 0));
const call = (url) => ajaxStub.calls.find((c) => c.url === url);
const liked = () => ({ actions_summary: [{ id: LIKE, acted: true, count: 1 }] });
const flagged = () => ({ actions_summary: [{ id: NOTIFY_MODERATORS, acted: true, count: 1 }] });

describe("thumbs up", () => {
  it("opens the note box first, and saves a like when it is left empty", async () => {
    const { bar } = mount();

    $(bar, ".js-up").click();
    assert.ok($(bar, ".bot-eval-form"), "the box opens");
    assert.equal(ajaxStub.calls.length, 0, "nothing is sent yet");

    $(bar, ".js-save").click();
    await settle();

    assert.deepEqual(call("/post_actions"), {
      url: "/post_actions",
      type: "POST",
      data: { id: 42, post_action_type_id: LIKE, flag_topic: false },
    });
  });

  it("posts a written note as a staff-only whisper", async () => {
    const { bar } = mount();

    $(bar, ".js-up").click();
    type(bar, "linked the right rulebook section");
    $(bar, ".js-save").click();
    await settle();

    const whisper = call("/posts");
    assert.equal(whisper.type, "POST");
    assert.equal(whisper.data.whisper, true);
    assert.equal(whisper.data.topic_id, 7);
    assert.equal(whisper.data.reply_to_post_number, 3);
    assert.match(whisper.data.raw, /linked the right rulebook section/);
  });

  it("sends no whisper when no note is written", async () => {
    const { bar } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/posts"), undefined);
  });

  it("skips the note box entirely when whispering is switched off", async () => {
    applySettings({ good_note_as_whisper: false });
    const { bar } = mount();

    $(bar, ".js-up").click();
    await settle();

    assert.equal($(bar, ".bot-eval-form"), null);
    assert.ok(call("/post_actions"), "it likes straight away");
  });

  it("takes the like back when pressed again", async () => {
    const { bar } = mount(makePost(liked()));

    $(bar, ".js-up").click();
    await settle();

    assert.deepEqual(ajaxStub.calls[0], {
      url: "/post_actions/42",
      type: "DELETE",
      data: { post_action_type_id: LIKE },
    });
  });
});

describe("thumbs up and the accepted solution", () => {
  it("accepts the reply as the solution", async () => {
    const { bar, post } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.deepEqual(call("/solution/accept"), {
      url: "/solution/accept",
      type: "POST",
      data: { id: 42 },
    });
    assert.equal(post.accepted_answer, true);
  });

  it("withdraws it when the like is taken back", async () => {
    const { bar } = mount(makePost({ ...liked(), accepted_answer: true }));

    $(bar, ".js-up").click();
    await settle();

    assert.ok(call("/solution/unaccept"));
  });

  it("leaves solutions alone when the Solved plugin is not installed", async () => {
    const { bar } = mount(makePost({ can_accept_answer: undefined }), { solved: false });

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.ok(call("/post_actions"), "the like still happens");
    assert.equal(call("/solution/accept"), undefined);
  });

  it("leaves solutions alone when the setting is off", async () => {
    applySettings({ mark_solution_on_good: false });
    const { bar } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/solution/accept"), undefined);
  });

  it("still records the like if accepting the solution fails", async () => {
    ajaxStub.setHandler((url) =>
      url.startsWith("/solution") ? Promise.reject(new Error("no solved here")) : Promise.resolve({})
    );
    const { bar, post } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(post.actions_summary.find((a) => a.id === LIKE).acted, true);
    assert.deepEqual(errorStub.errors, [], "the evaluator is not shown an error for a side errand");
  });
});

describe("thumbs down", () => {
  it("flags the reply with the written note, without taking action", async () => {
    const { bar } = mount();

    $(bar, ".js-down").click();
    type(bar, "quoted last year's deadline");
    $(bar, ".js-save").click();
    await settle();

    assert.deepEqual(call("/post_actions").data, {
      id: 42,
      post_action_type_id: NOTIFY_MODERATORS,
      message: "quoted last year's deadline",
      take_action: false,
      flag_topic: false,
    });
  });

  it("is allowed with no note at all, and sends a plain message in its place", async () => {
    const { bar } = mount();

    $(bar, ".js-down").click();
    $(bar, ".js-save").click();
    await settle();

    // Discourse requires a message on this flag type, so one is supplied.
    assert.equal(call("/post_actions").data.message, i18n("bot_eval.no_note.down"));
  });

  it("does not hide the reply", async () => {
    const { bar, post } = mount();

    $(bar, ".js-down").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(post.hidden, false);
  });

  it("withdraws the solution", async () => {
    const { bar } = mount(makePost({ accepted_answer: true }));

    $(bar, ".js-down").click();
    $(bar, ".js-save").click();
    await settle();

    assert.ok(call("/solution/unaccept"));
  });

  it("withdraws the flag when pressed again", async () => {
    const { bar } = mount(makePost(flagged()));

    $(bar, ".js-down").click();
    await settle();

    assert.deepEqual(ajaxStub.calls[0].data, { post_action_type_id: NOTIFY_MODERATORS });
  });
});

describe("mark for review", () => {
  it("flags with take action, which is what hides the reply", async () => {
    const { bar, post, article } = mount();

    $(bar, ".js-review").click();
    type(bar, "wrong submission deadline");
    $(bar, ".js-save").click();
    await settle();

    assert.deepEqual(call("/post_actions").data, {
      id: 42,
      post_action_type_id: NOTIFY_MODERATORS,
      message: "wrong submission deadline",
      take_action: true,
      flag_topic: false,
    });
    assert.equal(post.hidden, true);
    assert.ok(article.classList.contains("bot-eval-under-review"));
  });

  it("is allowed with no note", async () => {
    const { bar } = mount();

    $(bar, ".js-review").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/post_actions").data.message, i18n("bot_eval.no_note.review"));
    assert.equal(call("/post_actions").data.take_action, true);
  });

  it("only raises it for review when hiding is switched off", async () => {
    applySettings({ hide_on_review: false });
    const { bar, post } = mount();

    $(bar, ".js-review").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/post_actions").data.take_action, false);
    assert.equal(post.hidden, false);
  });

  it("un-hides the reply in one click", async () => {
    const { bar, post } = mount(makePost({ hidden: true }));

    $(bar, ".js-review").click();
    await settle();

    assert.deepEqual(ajaxStub.calls[0], { url: "/posts/42/unhide", type: "PUT", data: undefined });
    assert.equal(post.hidden, false);
    assert.equal($(bar, ".bot-eval-form"), null, "no note box for un-hiding");
  });

  it("withdraws the solution as well", async () => {
    const { bar } = mount(makePost({ accepted_answer: true }));

    $(bar, ".js-review").click();
    $(bar, ".js-save").click();
    await settle();

    assert.ok(call("/solution/unaccept"));
  });
});

describe("when something goes wrong", () => {
  it("shows the server's refusal and lets the evaluator try again", async () => {
    const failure = { jqXHR: { status: 403 } };
    ajaxStub.setHandler(() => Promise.reject(failure));
    const { bar } = mount();

    $(bar, ".js-down").click();
    type(bar, "wrong");
    $(bar, ".js-save").click();
    await settle();

    assert.deepEqual(errorStub.errors, [failure]);
    assert.equal($(bar, ".js-save").disabled, false);
  });

  it("blocks a double submission while the request is in flight", () => {
    ajaxStub.setHandler(() => new Promise(() => {}));
    const { bar } = mount();

    $(bar, ".js-down").click();
    $(bar, ".js-save").click();

    assert.ok($(bar, ".js-save").disabled);
    $(bar, ".js-save").click();
    assert.equal(ajaxStub.calls.length, 1);
  });

  it("closes the note box on cancel without sending anything", () => {
    const { bar } = mount();

    $(bar, ".js-down").click();
    type(bar, "half written");
    $(bar, ".js-cancel").click();

    assert.equal($(bar, ".bot-eval-form"), null);
    assert.equal(ajaxStub.calls.length, 0);
  });
});
