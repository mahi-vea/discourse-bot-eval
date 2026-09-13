import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./load.mjs";
import { applySettings, makePost, makeSite, makeUser } from "./fixtures.mjs";

let initializer;

before(async () => {
  applySettings();
  initializer = (await loadComponent()).default;
});

let cooked;

beforeEach(() => {
  applySettings();
  const dom = new JSDOM(`<article class="topic-post"><div class="cooked"><p>hi</p></div></article>`);
  globalThis.document = dom.window.document;
  cooked = dom.window.document.querySelector(".cooked");
});

// Runs the component the way Discourse does, and returns the decorator it
// registered — or null when it declined to register one at all.
function boot(user) {
  let decorator = null;
  initializer.initialize({
    getCurrentUser: () => user,
    container: {
      lookup: (name) =>
        name === "service:site" ? makeSite() : { solved_enabled: true },
    },
    decorateCookedElement: (callback) => (decorator = callback),
  });
  return decorator;
}

const decorate = (decorator, post) => decorator(cooked, { getModel: () => post });
const bars = () => cooked.querySelectorAll(".bot-eval-bar");

describe("who gets the bar", () => {
  it("a member of the configured group does", () => {
    const decorator = boot(makeUser(["eyantra_staff"]));
    assert.equal(typeof decorator, "function");

    decorate(decorator, makePost());
    assert.equal(bars().length, 1);
  });

  it("a member of any one of several configured groups does", () => {
    applySettings({ evaluator_groups: "eyantra_staff|content_team" });
    const decorator = boot(makeUser(["content_team"]));

    decorate(decorator, makePost());
    assert.equal(bars().length, 1);
  });

  it("somebody in a different group does not", () => {
    assert.equal(boot(makeUser(["students"])), null, "nothing is even registered");
  });

  it("somebody in no groups does not", () => {
    assert.equal(boot(makeUser([])), null);
  });

  it("an anonymous visitor does not", () => {
    assert.equal(boot(null), null);
  });

  it("nobody does while the group setting is empty", () => {
    applySettings({ evaluator_groups: "" });
    assert.equal(boot(makeUser(["eyantra_staff"])), null);
  });

  it("group names are matched regardless of case", () => {
    applySettings({ evaluator_groups: "eYantra_Staff" });
    const decorator = boot(makeUser(["eyantra_staff"]));

    decorate(decorator, makePost());
    assert.equal(bars().length, 1);
  });
});

describe("which posts get the bar", () => {
  let decorator;

  beforeEach(() => {
    decorator = boot(makeUser());
  });

  it("the bot's replies do", () => {
    decorate(decorator, makePost({ username: "rag_bot" }));
    assert.equal(bars().length, 1);
  });

  it("regardless of how the username is cased", () => {
    decorate(decorator, makePost({ username: "RAG_Bot" }));
    assert.equal(bars().length, 1);
  });

  it("a person's posts never do", () => {
    decorate(decorator, makePost({ username: "asha" }));
    assert.equal(bars().length, 0);
  });

  it("nothing does while the bot username setting is empty", () => {
    applySettings({ bot_usernames: "" });
    decorate(decorator, makePost());
    assert.equal(bars().length, 0);
  });

  it("nothing breaks outside the post stream", () => {
    assert.doesNotThrow(() => decorator(cooked, undefined));
    assert.doesNotThrow(() => decorator(cooked, {}));
    assert.doesNotThrow(() => decorator(cooked, { getModel: () => null }));
    assert.equal(bars().length, 0);
  });

  it("a re-render leaves exactly one bar", () => {
    decorate(decorator, makePost());
    decorate(decorator, makePost());
    decorate(decorator, makePost());
    assert.equal(bars().length, 1);
  });

  it("the bot's own words are left untouched", () => {
    decorate(decorator, makePost());
    assert.equal(cooked.querySelector("p").textContent, "hi");
    assert.equal(cooked.firstElementChild.tagName, "P");
  });
});
