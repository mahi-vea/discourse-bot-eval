import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./load.mjs";
import * as ajaxStub from "./stubs/ajax.mjs";
import { applySettings, makePost, makeSite, makeUser } from "./fixtures.mjs";

// Not every Discourse version sends the current user's groups to the browser.
// When it does not, the component asks the user's own profile endpoint instead,
// and posts drawn while that was in flight are picked up afterwards.

let initializer;
let groupNamesFrom;
let allowedFrom;

before(async () => {
  applySettings();
  ({ default: initializer, groupNamesFrom, allowedFrom } = await loadComponent());
});

let cooked;

beforeEach(() => {
  applySettings();
  ajaxStub.reset();
  const dom = new JSDOM(`<article class="topic-post"><div class="cooked"><p>hi</p></div></article>`, {
    url: "https://forum.example.com",
  });
  globalThis.document = dom.window.document;
  globalThis.sessionStorage = dom.window.sessionStorage;
  cooked = dom.window.document.querySelector(".cooked");
});

function boot(user) {
  let decorator = null;
  initializer.initialize({
    getCurrentUser: () => user,
    container: {
      lookup: (name) => (name === "service:site" ? makeSite() : { solved_enabled: true }),
    },
    decorateCookedElement: (callback) => (decorator = callback),
  });
  return decorator;
}

const decorate = (decorator, post = makePost()) => decorator(cooked, { getModel: () => post });
const bars = () => cooked.querySelectorAll(".bot-eval-bar");
const settle = () => new Promise((r) => setTimeout(r, 0));
const profileCalls = () => ajaxStub.calls.filter((c) => c.url.startsWith("/u/"));

describe("reading the group list", () => {
  it("takes it straight from the current user when it is there", () => {
    assert.deepEqual(groupNamesFrom({ groups: [{ name: "eYantra_Staff" }] }), ["eyantra_staff"]);
  });

  it("treats a missing or empty list as unknown rather than as 'no groups'", () => {
    assert.equal(groupNamesFrom({}), null);
    assert.equal(groupNamesFrom({ groups: [] }), null);
    assert.equal(groupNamesFrom(undefined), null);
  });

  it("matches any one of the configured groups, ignoring case", () => {
    applySettings({ evaluator_groups: "eyantra_staff|content_team" });

    assert.equal(allowedFrom(["content_team"]), true);
    assert.equal(allowedFrom(["students"]), false);
    assert.equal(allowedFrom([]), false);
    assert.equal(allowedFrom(null), false);
  });
});

describe("when the browser was not told the groups", () => {
  const blindUser = () => ({ username: "asha", moderator: true });

  it("asks the user's own profile endpoint", async () => {
    ajaxStub.setHandler(() => Promise.resolve({ user: { groups: [{ name: "eyantra_staff" }] } }));
    boot(blindUser());
    await settle();

    assert.equal(profileCalls().length, 1);
    assert.equal(profileCalls()[0].url, "/u/asha.json");
  });

  it("draws bars on posts that were rendered while it was still asking", async () => {
    let release;
    ajaxStub.setHandler(() => new Promise((r) => (release = r)));

    const decorator = boot(blindUser());
    decorate(decorator);
    assert.equal(bars().length, 0, "nothing is drawn on a guess");

    release({ user: { groups: [{ name: "eyantra_staff" }] } });
    await settle();

    assert.equal(bars().length, 1, "and the post is picked up once the answer arrives");
  });

  it("draws nothing when the answer says they are not a member", async () => {
    let release;
    ajaxStub.setHandler(() => new Promise((r) => (release = r)));

    const decorator = boot(blindUser());
    decorate(decorator);

    release({ user: { groups: [{ name: "students" }] } });
    await settle();

    assert.equal(bars().length, 0);
  });

  it("draws nothing when the lookup itself fails", async () => {
    ajaxStub.setHandler(() => Promise.reject(new Error("offline")));

    const decorator = boot(blindUser());
    decorate(decorator);
    await settle();

    assert.equal(bars().length, 0, "it fails closed, not open");
  });

  it("remembers the answer for the rest of the tab", async () => {
    ajaxStub.setHandler(() => Promise.resolve({ user: { groups: [{ name: "eyantra_staff" }] } }));

    boot(blindUser());
    await settle();
    assert.equal(profileCalls().length, 1);

    const decorator = boot(blindUser());
    decorate(decorator);

    assert.equal(profileCalls().length, 1, "no second lookup");
    assert.equal(bars().length, 1, "and it works without waiting");
  });

  it("never asks when the current user already carries the groups", async () => {
    boot(makeUser(["eyantra_staff"]));
    await settle();

    assert.equal(profileCalls().length, 0);
  });

  it("never asks when no group is configured at all", async () => {
    applySettings({ evaluator_groups: "" });
    boot(blindUser());
    await settle();

    assert.equal(profileCalls().length, 0);
  });
});
