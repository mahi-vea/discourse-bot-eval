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
const CACHE_KEY = "bot_eval_groups";

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

// --- who may evaluate ------------------------------------------------------
//
// Not every Discourse version sends the current user's groups to the browser,
// so the list is taken from whichever of these answers first: the current user
// serializer, this tab's cache, or the user's own profile endpoint.

export function groupNamesFrom(user) {
  const groups = user?.groups;
  if (!Array.isArray(groups) || groups.length === 0) {
    return null;
  }
  return groups.map((group) => String(group?.name || "").toLowerCase()).filter(Boolean);
}

export function allowedFrom(names) {
  const allowed = listSetting(settings.evaluator_groups);
  if (allowed.length === 0 || !Array.isArray(names)) {
    return false;
  }
  return allowed.some((name) => names.includes(name));
}

function readCache(username) {
  try {
    const raw = sessionStorage.getItem(`${CACHE_KEY}:${username}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(username, names) {
  try {
    sessionStorage.setItem(`${CACHE_KEY}:${username}`, JSON.stringify(names));
  } catch {
    // a browser with storage disabled simply asks again next page load
  }
}

function fetchGroupNames(username) {
  return ajax(`/u/${encodeURIComponent(username)}.json`)
    .then((result) => groupNamesFrom(result?.user) || [])
    .catch(() => []);
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
// theme, so its presence is detected rather than assumed.
function solvedAvailable(ctx, post) {
  return !!(ctx.solved || post?.can_accept_answer !== undefined);
}

// A note on a thumbs up has nowhere to live except a whisper, and only staff
// can whisper. `enable_whispers` is absent on versions that replaced it with a
// group setting, so only an explicit false counts against it.
function canWhisper(ctx) {
  return !!settings.good_note_as_whisper && ctx.whispers !== false && !!ctx.staff;
}

function readState(post, ctx) {
  const site = ctx.site;
  return {
    liked: acted(post, typeId(site, "like")),
    flagged: acted(post, typeId(site, "notify_moderators")),
    hidden: !!post.hidden,
    solution: !!post.accepted_answer,
    syncSolution: !!settings.mark_solution_on_good && solvedAvailable(ctx, post),
    noteOnGood: canWhisper(ctx),
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

  setPostField(post, "actions_summary", summary);
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

// --- rendering -------------------------------------------------------------

function hintFor(state, mode) {
  const hint = t(`hint.${mode}`);
  return state.syncSolution ? `${hint} ${t(`hint_solution.${mode}`)}` : hint;
}

export function template(state, mode, notice = null) {
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
  if (notice) {
    status += `<div class="bot-eval-status is-warning js-notice">${esc(notice)}</div>`;
  }
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

export function renderBar(bar, post, ctx, mode = null, notice = null) {
  const site = ctx.site;
  const state = readState(post, ctx);
  bar.innerHTML = template(state, mode, notice);

  bar.querySelector(".js-text")?.focus();
  bar.closest(".topic-post")?.classList.toggle("bot-eval-under-review", state.hidden);

  const busy = (on) => bar.querySelectorAll("button").forEach((b) => (b.disabled = on));
  const redraw = (next = null, message = null) => renderBar(bar, post, ctx, next, message);

  // Each action resolves to a notice, or to nothing when all went well. A
  // failure in the main call rejects and is shown the usual way.
  const run = (work) => {
    busy(true);

    let started;
    try {
      started = work(); // fired now, not a microtask later
    } catch (error) {
      busy(false);
      popupAjaxError(error);
      return;
    }

    return Promise.resolve(started)
      .then((message) => redraw(null, message || null))
      .catch((error) => {
        busy(false);
        popupAjaxError(error);
      });
  };

  // A note is never required. When none is written the flag still needs a
  // message, so a plain one is sent in its place.
  const noteOr = (value, forMode) => (value ? value : t(`no_note.${forMode}`));

  const withSolution = (shouldAccept, carried) => {
    if (!state.syncSolution) {
      return carried;
    }
    if (shouldAccept && !state.solution) {
      return acceptSolution(post).then(
        () => {
          setPostField(post, "accepted_answer", true);
          return carried;
        },
        () => carried || t("notice.solution_failed")
      );
    }
    if (!shouldAccept && state.solution) {
      return unacceptSolution(post).then(
        () => {
          setPostField(post, "accepted_answer", false);
          return carried;
        },
        () => carried || t("notice.solution_failed")
      );
    }
    return carried;
  };

  const saveUp = (note) =>
    run(() =>
      like(post, site)
        .then(() => setActed(post, typeId(site, "like"), true))
        .then(() =>
          note && state.noteOnGood
            ? whisper(post, note).then(
                () => null,
                () => t("notice.whisper_failed")
              )
            : null
        )
        .then((carried) => withSolution(true, carried))
    );

  bar.querySelector(".js-up")?.addEventListener("click", () => {
    if (state.liked) {
      return run(() =>
        unlike(post, site)
          .then(() => setActed(post, typeId(site, "like"), false))
          .then(() => withSolution(false, null))
      );
    }
    // The note box is only worth opening if the note has somewhere to go.
    return state.noteOnGood ? redraw("up") : saveUp("");
  });

  bar.querySelector(".js-down")?.addEventListener("click", () => {
    if (state.flagged) {
      return run(() =>
        unflag(post, site).then(() => setActed(post, typeId(site, "notify_moderators"), false))
      );
    }
    return redraw("down");
  });

  bar.querySelector(".js-review")?.addEventListener("click", () => {
    if (state.hidden) {
      return run(() => unhide(post).then(() => setPostField(post, "hidden", false)));
    }
    return redraw("review");
  });

  bar.querySelector(".js-cancel")?.addEventListener("click", () => redraw());

  bar.querySelector(".js-save")?.addEventListener("click", () => {
    const note = (bar.querySelector(".js-text")?.value || "").trim();

    if (mode === "up") {
      return saveUp(note);
    }

    const takeAction = mode === "review" && !!settings.hide_on_review;

    return run(() =>
      flag(post, site, noteOr(note, mode), takeAction)
        .then(() => setActed(post, typeId(site, "notify_moderators"), true))
        .then(() => {
          if (takeAction) {
            setPostField(post, "hidden", true);
          }
        })
        .then(() => withSolution(false, null))
    );
  });
}

export default apiInitializer("1.8.0", (api) => {
  const currentUser = api.getCurrentUser();
  if (!currentUser || listSetting(settings.evaluator_groups).length === 0) {
    return;
  }

  const siteSettings = api.container.lookup("service:site-settings");
  const ctx = {
    site: api.container.lookup("service:site"),
    solved: !!siteSettings?.solved_enabled,
    whispers: siteSettings?.enable_whispers,
    staff: !!(currentUser.staff || currentUser.moderator || currentUser.admin),
    allowed: null,
  };

  const draw = (element, post) => {
    element.querySelectorAll(`.${BAR}`).forEach((node) => node.remove());
    const bar = document.createElement("div");
    bar.className = BAR;
    element.appendChild(bar);
    renderBar(bar, post, ctx);
  };

  // Posts rendered before the group lookup came back, so they can be given a
  // bar once the answer arrives instead of being missed.
  const waiting = [];

  const known = groupNamesFrom(currentUser) || readCache(currentUser.username);
  if (known) {
    ctx.allowed = allowedFrom(known);
    if (!ctx.allowed) {
      return;
    }
  } else {
    fetchGroupNames(currentUser.username).then((names) => {
      writeCache(currentUser.username, names);
      ctx.allowed = allowedFrom(names);

      const queued = waiting.splice(0, waiting.length);
      if (ctx.allowed) {
        queued.forEach(([element, post]) => {
          if (element.isConnected !== false) {
            draw(element, post);
          }
        });
      }
    });
  }

  api.decorateCookedElement((element, helper) => {
    if (!helper?.getModel) {
      return;
    }

    const post = helper.getModel();
    if (!post || !isBotPost(post)) {
      return;
    }

    if (ctx.allowed === null) {
      waiting.push([element, post]);
      return;
    }
    if (!ctx.allowed) {
      return;
    }

    draw(element, post);
  });
});
