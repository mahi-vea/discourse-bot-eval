import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./load.mjs";
import { i18n } from "./stubs/i18n.mjs";
import * as ajaxStub from "./stubs/ajax.mjs";
import * as errorStub from "./stubs/ajax-error.mjs";
import { applySettings, makePost, makeNote, makeCtx, LIKE, TAG } from "./fixtures.mjs";

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
const notice = (bar) => $(bar, ".js-notice")?.textContent?.trim() || null;

describe("thumbs up", () => {
  it("accepts the reply as the topic's solution", async () => {
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

  it("likes the reply as well", async () => {
    const { bar, post } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.deepEqual(call("/post_actions").data, {
      id: 42,
      post_action_type_id: LIKE,
      flag_topic: false,
    });
    assert.equal(post.actions_summary.find((a) => a.id === LIKE).acted, true);
  });

  it("still marks the solution when the like fails", async () => {
    ajaxStub.setHandler((url) =>
      url === "/post_actions" ? Promise.reject(new Error("already liked")) : Promise.resolve({})
    );
    const { bar, post } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(post.accepted_answer, true, "the solution is the point of a thumbs up");
    assert.deepEqual(errorStub.errors, []);
  });

  it("records a written note as a staff-only whisper", async () => {
    const { bar } = mount();

    $(bar, ".js-up").click();
    type(bar, "linked the right rulebook section");
    $(bar, ".js-save").click();
    await settle();

    const note = call("/posts");
    assert.equal(note.data.whisper, true);
    assert.equal(note.data.topic_id, 7);
    assert.equal(note.data.reply_to_post_number, 3);
    assert.equal(note.data.raw, `${TAG.up} linked the right rulebook section`);
  });

  it("records a note even when none was typed, so a good reply is findable", async () => {
    const { bar } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/posts").data.raw, `${TAG.up} ${i18n("bot_eval.no_note.up")}`);
  });

  it("takes the solution, the like and the note back when pressed again", async () => {
    const note = makeNote(TAG.up, { id: 901 });
    const { bar, post } = mount(makePost({ accepted_answer: true }, [note]));

    $(bar, ".js-up").click();
    await settle();

    assert.ok(call("/solution/unaccept"));
    assert.deepEqual(call("/post_actions/42").data, { post_action_type_id: LIKE });
    assert.ok(call("/posts/901"), "the note goes too");
    assert.equal(post.accepted_answer, false);
  });

  it("is not confused by a like or a solution somebody else gave", () => {
    const { bar } = mount(makePost({ accepted_answer: true, actions_summary: [{ id: LIKE, acted: true }] }));

    assert.doesNotMatch(bar.innerHTML, /js-up is-active/, "only our own note counts as a rating");
  });
});

describe("thumbs up when solutions are not available", () => {
  it("says so plainly when the category has them switched off", async () => {
    const { bar, post } = mount(makePost({ can_accept_answer: false }));

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/solution/accept"), undefined, "it does not call an endpoint that will refuse");
    assert.equal(notice(bar), i18n("bot_eval.notice.solution_not_here"));
    assert.ok(call("/post_actions"), "the like still happens");
    assert.equal(post.accepted_answer, false);
  });

  it("repeats the server's own words when the call is refused", async () => {
    ajaxStub.setHandler((url) =>
      url.startsWith("/solution")
        ? Promise.reject({ jqXHR: { responseJSON: { errors: ["You are not permitted to view"] } } })
        : Promise.resolve({})
    );
    const { bar } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.match(notice(bar), /You are not permitted to view/);
  });

  it("stays quiet about solutions when the Solved plugin is absent", async () => {
    const { bar } = mount(makePost({ can_accept_answer: undefined }), { solved: false });

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/solution/accept"), undefined);
    assert.equal(notice(bar), null);
    assert.ok(call("/post_actions"), "it still records the like");
  });

  it("stays quiet when the admin switched the link off", async () => {
    applySettings({ mark_solution_on_good: false });
    const { bar } = mount();

    $(bar, ".js-up").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/solution/accept"), undefined);
    assert.equal(notice(bar), null);
  });
});

describe("needs work", () => {
  it("records the reason as a staff-only whisper and nothing else", async () => {
    const { bar, post } = mount();

    $(bar, ".js-down").click();
    type(bar, "quoted last year's deadline");
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/posts").data.raw, `${TAG.down} quoted last year's deadline`);
    assert.equal(call("/posts").data.whisper, true);

    // No flag is raised: a flag would be scored against the bot's account.
    assert.equal(call("/post_actions"), undefined);
    assert.equal(post.deleted_at, null, "and the reply stays public");
  });

  it("is allowed with no reason at all", async () => {
    const { bar } = mount();

    $(bar, ".js-down").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/posts").data.raw, `${TAG.down} ${i18n("bot_eval.no_note.down")}`);
  });

  it("withdraws the solution", async () => {
    const { bar } = mount(makePost({ accepted_answer: true }));

    $(bar, ".js-down").click();
    $(bar, ".js-save").click();
    await settle();

    assert.ok(call("/solution/unaccept"));
  });

  it("shows as given once the note is in the topic", () => {
    const { bar } = mount(makePost({}, [makeNote(TAG.down)]));

    assert.match(bar.innerHTML, /js-down is-active/);
  });

  it("lights the button up straight away, before any reload", async () => {
    const { bar } = mount();

    $(bar, ".js-down").click();
    type(bar, "wrong deadline");
    $(bar, ".js-save").click();
    await settle();

    assert.match(bar.innerHTML, /js-down is-active/);
  });

  it("replaces an earlier rating instead of stacking a second one", async () => {
    const note = makeNote(TAG.up, { id: 901 });
    const { bar } = mount(makePost({}, [note]));

    $(bar, ".js-down").click();
    type(bar, "changed my mind");
    $(bar, ".js-save").click();
    await settle();

    assert.ok(call("/posts/901"), "the thumbs up note is removed");
    assert.equal(call("/posts").data.raw, `${TAG.down} changed my mind`);
    assert.match(bar.innerHTML, /js-down is-active/);
    assert.doesNotMatch(bar.innerHTML, /js-up is-active/);
  });

  it("is undone by deleting that note", async () => {
    const note = makeNote(TAG.down, { id: 901 });
    const { bar } = mount(makePost({}, [note]));

    $(bar, ".js-down").click();
    await settle();

    assert.deepEqual(ajaxStub.calls[0], { url: "/posts/901", type: "DELETE", data: undefined });
    assert.equal($(bar, ".bot-eval-form"), null, "no note box for undoing");
  });

  it("ignores a note already taken back", () => {
    const { bar } = mount(makePost({}, [makeNote(TAG.down, { deleted_at: "2026-09-13T09:00:00Z" })]));

    assert.doesNotMatch(bar.innerHTML, /js-down is-active/);
  });

  it("ignores a note somebody else wrote", () => {
    const { bar } = mount(makePost({}, [makeNote(TAG.down, { user_id: 99 })]));

    assert.doesNotMatch(bar.innerHTML, /js-down is-active/);
  });

  it("ignores a note about a different reply", () => {
    const { bar } = mount(makePost({}, [makeNote(TAG.down, { reply_to_post_number: 99 })]));

    assert.doesNotMatch(bar.innerHTML, /js-down is-active/);
  });

  it("ignores an ordinary public reply that happens to quote the tag", () => {
    const { bar } = mount(makePost({}, [makeNote(TAG.down, { post_type: 1 })]));

    assert.doesNotMatch(bar.innerHTML, /js-down is-active/);
  });
});

describe("mark for review", () => {
  it("records the reason, then deletes the reply", async () => {
    const { bar, post, article } = mount();

    $(bar, ".js-review").click();
    type(bar, "wrong submission deadline");
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/posts").data.raw, `${TAG.review} wrong submission deadline`);
    assert.deepEqual(call("/posts/42"), { url: "/posts/42", type: "DELETE", data: undefined });
    assert.ok(post.deleted_at);
    assert.ok(article.classList.contains("bot-eval-under-review"));
  });

  it("raises no flag against the bot", async () => {
    const { bar } = mount();

    $(bar, ".js-review").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(call("/post_actions"), undefined);
  });

  it("keeps the note but removes nothing when hiding is switched off", async () => {
    applySettings({ hide_on_review: false });
    const { bar, post } = mount();

    $(bar, ".js-review").click();
    $(bar, ".js-save").click();
    await settle();

    assert.ok(call("/posts"), "the note is still recorded");
    assert.equal(call("/posts/42"), undefined);
    assert.equal(post.deleted_at, null);
  });

  it("puts the reply back and clears the rating in one click", async () => {
    const note = makeNote(TAG.review, { id: 901 });
    const { bar, post } = mount(makePost({ deleted_at: "2026-09-13T09:00:00Z" }, [note]));

    $(bar, ".js-review").click();
    await settle();

    assert.deepEqual(ajaxStub.calls[0], { url: "/posts/42/recover", type: "PUT", data: undefined });
    assert.ok(call("/posts/901"), "the note goes too");
    assert.equal(post.deleted_at, null);
    assert.equal($(bar, ".bot-eval-form"), null, "no note box for putting it back");
  });

  it("keeps the note when the deletion is refused" , async () => {
    ajaxStub.setHandler((url, opts) =>
      opts.type === "DELETE" ? Promise.reject(new Error("not a moderator")) : Promise.resolve({})
    );
    const { bar, post } = mount();

    $(bar, ".js-review").click();
    type(bar, "wrong deadline");
    $(bar, ".js-save").click();
    await settle();

    assert.ok(call("/posts"), "the reason survives");
    assert.match(notice(bar), /could not be removed/i);
    assert.equal(post.deleted_at, null, "and it does not pretend otherwise");
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
  it("reports a refusal of the action itself the usual way", async () => {
    const failure = { jqXHR: { status: 403 } };
    ajaxStub.setHandler((url) => (url === "/posts" ? Promise.reject(failure) : Promise.resolve({})));
    const { bar } = mount();

    $(bar, ".js-down").click();
    type(bar, "wrong");
    $(bar, ".js-save").click();
    await settle();

    assert.match(notice(bar), /could not be saved/i);
  });

  it("blocks a double submission while the request is in flight", async () => {
    ajaxStub.setHandler(() => new Promise(() => {}));
    const { bar } = mount();

    $(bar, ".js-down").click();
    $(bar, ".js-save").click();

    assert.ok($(bar, ".js-save").disabled, "the buttons lock at once");

    $(bar, ".js-save").click();
    $(bar, ".js-save").click();
    await settle();

    assert.equal(ajaxStub.calls.length, 1, "and only one note is ever written");
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
