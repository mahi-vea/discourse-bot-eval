export const LIKE = 2;

export const TAG = {
  up: "[bot-eval:good]",
  down: "[bot-eval:needs-work]",
  review: "[bot-eval:review]",
};

export function makeSite() {
  return {
    post_action_types: [
      { id: LIKE, name_key: "like" },
      { id: 4, name_key: "inappropriate" },
    ],
  };
}

// A staff-only whisper of the kind the component writes, sitting in the
// topic's post stream where the component looks for it.
export function makeNote(tag, overrides = {}) {
  return {
    id: 900,
    post_type: 4,
    user_id: 1,
    reply_to_post_number: 3,
    raw: `${tag} something`,
    deleted_at: null,
    set(key, value) {
      this[key] = value;
    },
    ...overrides,
  };
}

export function makePost(overrides = {}, notes = []) {
  return {
    id: 42,
    topic_id: 7,
    post_number: 3,
    username: "rag_bot",
    hidden: false,
    deleted_at: null,
    accepted_answer: false,
    can_accept_answer: true,
    actions_summary: [],
    topic: { postStream: { posts: notes } },
    set(key, value) {
      this[key] = value;
    },
    ...overrides,
  };
}

export function makeUser(groups = ["eyantra_staff"], overrides = {}) {
  return {
    id: 1,
    username: "asha",
    moderator: true,
    groups: groups.map((name) => ({ name })),
    ...overrides,
  };
}

// What the initializer builds and hands to renderBar.
export function makeCtx(overrides = {}) {
  return {
    site: makeSite(),
    solved: true,
    staff: true,
    whispers: undefined,
    userId: 1,
    ...overrides,
  };
}

export const DEFAULT_SETTINGS = {
  bot_usernames: "rag_bot",
  evaluator_groups: "eyantra_staff",
  hide_on_review: true,
  mark_solution_on_good: true,
};

export function applySettings(overrides = {}) {
  globalThis.settings = { ...DEFAULT_SETTINGS, ...overrides };
}

globalThis.themePrefix = (key) => key;
