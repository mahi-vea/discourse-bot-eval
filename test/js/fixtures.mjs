export const LIKE = 2;
export const NOTIFY_MODERATORS = 7;

export function makeSite() {
  return {
    post_action_types: [
      { id: LIKE, name_key: "like" },
      { id: NOTIFY_MODERATORS, name_key: "notify_moderators" },
      { id: 4, name_key: "inappropriate" },
    ],
  };
}

export function makePost(overrides = {}) {
  return {
    id: 42,
    topic_id: 7,
    post_number: 3,
    username: "rag_bot",
    hidden: false,
    accepted_answer: false,
    can_accept_answer: true,
    actions_summary: [],
    set(key, value) {
      this[key] = value;
    },
    ...overrides,
  };
}

export function makeUser(groups = ["eyantra_staff"]) {
  return { username: "asha", groups: groups.map((name) => ({ name })) };
}

export const DEFAULT_SETTINGS = {
  bot_usernames: "rag_bot",
  evaluator_groups: "eyantra_staff",
  hide_on_review: true,
  mark_solution_on_good: true,
  good_note_as_whisper: true,
};

export function applySettings(overrides = {}) {
  globalThis.settings = { ...DEFAULT_SETTINGS, ...overrides };
}

// In a real theme this prefixes the key with the theme id; the stub locale file
// is keyed without it.
globalThis.themePrefix = (key) => key;
