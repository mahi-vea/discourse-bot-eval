import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import { escapeExpression } from "discourse/lib/utilities";
import * as I18nModule from "discourse-i18n";

// A theme component cannot add tables, routes or serializers, so every rating
// is recorded through Discourse's own API, as the signed-in user:
//
//   Good          -> a like (+ optional staff-only whisper, + accept solution)
//   Needs work    -> a "Something Else" flag carrying the note
//   Mark review   -> the same flag with "take action", which hides the reply
//
// Discourse authenticates and authorises all of that itself, so none of it can
// be forged by editing this file in a browser.

const BAR = "bot-eval-bar";

function t(key, opts) {
  const full = themePrefix(`bot_eval.${key}`);
  if (typeof I18nModule.i18n === "function") {
    return I18nModule.i18n(full, opts);
  }
  return I18nModule.default.t(full, opts);
}

const esc = (value) => escapeExpression(value == null ? "" : String(value));
const icon = (name) =>
  `<svg class="fa d-icon d-icon-${name} svg-icon svg-string"><use href="#${name}"></use></svg>`;

// --- configuration ---------------------------------------------------------

function listSetting(value) {
  return String(value || "")
    .split("|")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function isBotPost(post) {
  const names = listSetting(settings.bot_usernames);
  return names.length > 0 && names.includes(String(post?.username || "").toLowerCase());
}

function isEvaluator(user) {
  const allowed = listSetting(settings.evaluator_groups);
  if (!user || allowed.length === 0) {
    return false;
  }
  const mine = (user.groups || []).map((group) => String(group.name || "").toLowerCase());
  return allowed.some((name) => mine.includes(name));
}

// --- reading and writing Discourse's own state -----------------------------

function typeId(site, nameKey) {
  const types = site?.post_action_types || site?.postActionTypes || [];
  return types.find((type) => type.name_key === nameKey)?.id;
}

function acted(post, id) {
  return !!(id && (post.actions_summary || []).some((a) => a.id === id && a.acted));
}

// discourse-solved is a plugin in its own right. It cannot be installed from a
// theme, so its presence is detected rather than assumed: the site setting it
// exposes to the browser, or the field it adds to every post serializer.
function solvedAvailable(ctx, post) {
  return !!(ctx.solved || post?.can_accept_answer !== undefined);
}

function readState(post, ctx) {
  const site = ctx.site;
  return {
    liked: acted(post, typeId(site, "like")),
    flagged: acted(post, typeId(site, "notify_moderators")),
    hidden: !!post.hidden,
    solution: !!post.accepted_answer,
    syncSolution: !!settings.mark_solution_on_good && solvedAvailable(ctx, post),
    noteOnGood: !!settings.good_note_as_whisper,
  };
}

function setActed(post, id, value) {
  if (!id) {
    return;
  }
  const summary = post.actions_summary ? [...post.actions_summary] : [];
  const index = summary.findIndex((a) => a.id === id);
  const entry = index >= 0 ? { ...summary[index] } : { id, count: 0 };

  entry.acted = value;
  entry.count = Math.max(0, (entry.count || 0) + (value ? 1 : -1));

  if (index >= 0) {
    summary[index] = entry;
  } else {
    summary.push(entry);
  }

  try {
    post.set("actions_summary", summary);
  } catch {
    post.actions_summary = summary;
  }
}

function setPostField(post, key, value) {
  try {
    post.set(key, value);
  } catch {
    post[key] = value;
  }
}

// --- the calls themselves --------------------------------------------------

const like = (post, site) =>
  ajax("/post_actions", {
    type: "POST",
    data: { id: post.id, post_action_type_id: typeId(site, "like"), flag_topic: false },
  });

const unlike = (post, site) =>
  ajax(`/post_actions/${post.id}`, {
    type: "DELETE",
    data: { post_action_type_id: typeId(site, "like") },
  });

const flag = (post, site, message, takeAction) =>
  ajax("/post_actions", {
    type: "POST",
    data: {
      id: post.id,
      post_action_type_id: typeId(site, "notify_moderators"),
      message,
      take_action: !!takeAction,
      flag_topic: false,
    },
  });

const unflag = (post, site) =>
  ajax(`/post_actions/${post.id}`, {
    type: "DELETE",
    data: { post_action_type_id: typeId(site, "notify_moderators") },
  });

const unhide = (post) => ajax(`/posts/${post.id}/unhide`, { type: "PUT" });

const whisper = (post, note) =>
  ajax("/posts", {
    type: "POST",
    data: {
      topic_id: post.topic_id,
      reply_to_post_number: post.post_number,
      raw: `${t("whisper_prefix")} ${note}`,
      whisper: true,
    },
  });

const acceptSolution = (post) => ajax("/solution/accept", { type: "POST", data: { id: post.id } });
const unacceptSolution = (post) =>
  ajax("/solution/unaccept", { type: "POST", data: { id: post.id } });

// Side errands (the whisper, the solution) must never sink the rating itself.
const soft = (promise) => promise.catch(() => false);

// --- rendering -------------------------------------------------------------

function hintFor(state, mode) {
  const hint = t(`hint.${mode}`);
  return state.syncSolution ? `${hint} ${t(`hint_solution.${mode}`)}` : hint;
}

export function template(state, mode) {
  const buttons = `
    <div class="bot-eval-row">
      <span class="bot-eval-title">${esc(t("title"))}</span>
      <button type="button" class="btn btn-default bot-eval-btn js-up ${state.liked ? "is-active" : ""}">
        ${icon("thumbs-up")}<span class="d-button-label">${esc(t("up"))}</span>
      </button>
      <button type="button" class="btn btn-default bot-eval-btn js-down ${state.flagged ? "is-active" : ""}">
        ${icon("thumbs-down")}<span class="d-button-label">${esc(t("down"))}</span>
      </button>
      <button type="button" class="btn btn-default bot-eval-btn js-review ${state.hidden ? "is-active" : ""}">
        ${icon(state.hidden ? "eye" : "eye-slash")}<span class="d-button-label">${esc(
          state.hidden ? t("unmark_review") : t("mark_review")
        )}</span>
      </button>
    </div>`;

  const form = mode
    ? `<div class="bot-eval-form">
         <div class="bot-eval-hint">${esc(hintFor(state, mode))}</div>
         <textarea class="js-text" rows="3" placeholder="${esc(t(`placeholder.${mode}`))}"></textarea>
         <div class="bot-eval-form-actions">
           <button type="button" class="btn btn-primary js-save">${esc(t("save"))}</button>
           <button type="button" class="btn btn-flat js-cancel">${esc(t("cancel"))}</button>
         </div>
       </div>`
    : "";

  let status = "";
  if (state.hidden) {
    status += `<div class="bot-eval-status is-review">${esc(t("status.hidden"))}</div>`;
  }
  if (state.solution) {
    status += `<div class="bot-eval-status is-solution">${esc(t("status.solution"))}</div>`;
  }
  if (state.liked) {
    status += `<div class="bot-eval-status">${esc(t("status.liked"))}</div>`;
  }
  if (state.flagged) {
    status += `<div class="bot-eval-status">${esc(t("status.flagged"))}</div>`;
  }

  return buttons + form + status;
}

export function renderBar(bar, post, ctx, mode = null) {
  const site = ctx.site;
  const state = readState(post, ctx);
  bar.innerHTML = template(state, mode);

  const textarea = bar.querySelector(".js-text");
  textarea?.focus();

  bar.closest(".topic-post")?.classList.toggle("bot-eval-under-review", state.hidden);

  const busy = (on) => bar.querySelectorAll("button").forEach((b) => (b.disabled = on));
  const redraw = (next = null) => renderBar(bar, post, ctx, next);

  const run = (work) => {
    busy(true);
    return work
      .then(() => redraw())
      .catch((error) => {
        busy(false);
        popupAjaxError(error);
      });
  };

  // A note is never required. When none is written the flag still needs a
  // message, so a plain one is sent in its place.
  const noteOr = (value, mode_) => (value ? value : t(`no_note.${mode_}`));

  bar.querySelector(".js-up")?.addEventListener("click", () => {
    if (state.liked) {
      return run(
        unlike(post, site).then(() => {
          setActed(post, typeId(site, "like"), false);
          return state.syncSolution && state.solution ? soft(unacceptSolution(post)) : null;
        })
      );
    }
    // The note box is only worth opening if the note has somewhere to go.
    return state.noteOnGood ? redraw("up") : saveUp("");
  });

  bar.querySelector(".js-down")?.addEventListener("click", () => {
    if (state.flagged) {
      return run(unflag(post, site).then(() => setActed(post, typeId(site, "notify_moderators"), false)));
    }
    return redraw("down");
  });

  bar.querySelector(".js-review")?.addEventListener("click", () => {
    if (state.hidden) {
      return run(unhide(post).then(() => setPostField(post, "hidden", false)));
    }
    return redraw("review");
  });

  bar.querySelector(".js-cancel")?.addEventListener("click", () => redraw());

  function saveUp(note) {
    return run(
      like(post, site)
        .then(() => setActed(post, typeId(site, "like"), true))
        .then(() => (note ? soft(whisper(post, note)) : null))
        .then(() =>
          state.syncSolution && !state.solution
            ? soft(acceptSolution(post)).then(() => setPostField(post, "accepted_answer", true))
            : null
        )
    );
  }

  bar.querySelector(".js-save")?.addEventListener("click", () => {
    const note = (textarea?.value || "").trim();

    if (mode === "up") {
      return saveUp(note);
    }

    const takeAction = mode === "review" && !!settings.hide_on_review;

    return run(
      flag(post, site, noteOr(note, mode), takeAction)
        .then(() => setActed(post, typeId(site, "notify_moderators"), true))
        .then(() => {
          if (takeAction) {
            setPostField(post, "hidden", true);
          }
        })
        .then(() =>
          state.syncSolution && state.solution
            ? soft(unacceptSolution(post)).then(() => setPostField(post, "accepted_answer", false))
            : null
        )
    );
  });
}

export default apiInitializer("1.8.0", (api) => {
  const currentUser = api.getCurrentUser();
  if (!isEvaluator(currentUser)) {
    return;
  }

  const ctx = {
    site: api.container.lookup("service:site"),
    solved: !!api.container.lookup("service:site-settings")?.solved_enabled,
  };

  api.decorateCookedElement((element, helper) => {
    if (!helper?.getModel) {
      return;
    }

    const post = helper.getModel();
    if (!post || !isBotPost(post)) {
      return;
    }

    element.querySelectorAll(`.${BAR}`).forEach((node) => node.remove());

    const bar = document.createElement("div");
    bar.className = BAR;
    element.appendChild(bar);
    renderBar(bar, post, ctx);
  });
});
