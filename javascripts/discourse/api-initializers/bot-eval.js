import { apiInitializer } from "discourse/lib/api";
import { ajax } from "discourse/lib/ajax";
import { popupAjaxError } from "discourse/lib/ajax-error";
import { escapeExpression } from "discourse/lib/utilities";
import * as I18nModule from "discourse-i18n";

// A theme component cannot add tables, routes or serializers, so every rating
// is recorded through Discourse's own API, as the signed-in user:
//
//   Good        -> accept the reply as the topic's solution, and like it
//   Needs work  -> a staff-only whisper carrying the reason
//   Mark review -> delete the reply (moderators still see it), plus a whisper
//
// Nothing here flags anything. Flags are scored against the account they are
// raised on and can trip Discourse's auto-silence thresholds, which would
// eventually silence the bot; they also cannot be retracted once acted on.
// Whispers and deletions carry no penalty and undo cleanly.

const BAR = "bot-eval-bar";
const CACHE_KEY = "bot_eval_groups";
const WHISPER = 4; // Post.types[:whisper]

// Machine-readable markers, so the notes can be pulled out later with one query.
const TAG = {
  up: "[bot-eval:good]",
  down: "[bot-eval:needs-work]",
  review: "[bot-eval:review]",
};

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

// The server's own words are far more useful than a guess at what went wrong.
function reason(error) {
  const body = error?.jqXHR?.responseJSON || error?.responseJSON;
  const message = body?.errors?.[0] || body?.error || error?.message;
  return message ? String(message) : null;
}

const withReason = (base, error) => {
  const detail = reason(error);
  return detail ? `${base} (${detail})` : base;
};

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

// --- reading Discourse's own state -----------------------------------------

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

// The notes are ordinary whispers in the same topic, so the evaluator's own one
// can be found in the post stream and taken back.
export function findNote(post, ctx, tag) {
  let stream = [];
  try {
    stream = post?.topic?.postStream?.posts || [];
  } catch {
    stream = [];
  }

  return stream.find(
    (entry) =>
      entry &&
      entry.post_type === WHISPER &&
      (ctx.userId == null || entry.user_id === ctx.userId) &&
      entry.reply_to_post_number === post.post_number &&
      String(entry.raw || entry.cooked || "").includes(tag)
  );
}

function readState(post, ctx) {
  const site = ctx.site;
  return {
    liked: acted(post, typeId(site, "like")),
    solution: !!post.accepted_answer,
    solutionHere: post.can_accept_answer !== false,
    syncSolution: !!settings.mark_solution_on_good && solvedAvailable(ctx, post),
    hidden: !!post.deleted_at || !!post.hidden,
    downNote: findNote(post, ctx, TAG.down),
    canNote: ctx.whispers !== false && !!ctx.staff,
  };
}

function setPostField(post, key, value) {
  try {
    post.set(key, value);
  } catch {
    post[key] = value;
  }
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

const acceptSolution = (post) => ajax("/solution/accept", { type: "POST", data: { id: post.id } });
const unacceptSolution = (post) =>
  ajax("/solution/unaccept", { type: "POST", data: { id: post.id } });

const whisper = (post, tag, note) =>
  ajax("/posts", {
    type: "POST",
    data: {
      topic_id: post.topic_id,
      reply_to_post_number: post.post_number,
      raw: `${tag} ${note}`,
      whisper: true,
    },
  });

// Taking a reply out of public view: moderators still see it, one call puts it
// back, and the bot account collects nothing against it.
const removePost = (id) => ajax(`/posts/${id}`, { type: "DELETE" });
const restorePost = (id) => ajax(`/posts/${id}/recover`, { type: "PUT" });

// --- rendering -------------------------------------------------------------

function hintFor(state, mode) {
  const hint = t(`hint.${mode}`);
  return state.syncSolution ? `${hint} ${t(`hint_solution.${mode}`)}` : hint;
}

export function template(state, mode, notice = null) {
  const buttons = `
    <div class="bot-eval-row">
      <span class="bot-eval-title">${esc(t("title"))}</span>
      <button type="button" class="btn btn-default bot-eval-btn js-up ${
        state.solution || state.liked ? "is-active" : ""
      }">
        ${icon("thumbs-up")}<span class="d-button-label">${esc(t("up"))}</span>
      </button>
      <button type="button" class="btn btn-default bot-eval-btn js-down ${
        state.downNote ? "is-active" : ""
      }">
        ${icon("thumbs-down")}<span class="d-button-label">${esc(t("down"))}</span>
      </button>
      <button type="button" class="btn btn-default bot-eval-btn js-review ${
        state.hidden ? "is-active" : ""
      }">
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
  if (state.liked && !state.solution) {
    status += `<div class="bot-eval-status">${esc(t("status.liked"))}</div>`;
  }
  if (state.downNote) {
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

  // Each action resolves to a notice, or to nothing when all went well. Only a
  // failure of the *main* point of the action rejects and pops up.
  const run = (work) => {
    busy(true);

    let started;
    try {
      started = work();
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

  const noteOr = (value, forMode) => (value ? value : t(`no_note.${forMode}`));

  const saveNote = (tag, forMode, note, carried) => {
    if (!state.canNote) {
      return carried || t("notice.note_required_off");
    }
    return whisper(post, tag, noteOr(note, forMode)).then(
      () => carried,
      (error) => carried || withReason(t("notice.whisper_failed"), error)
    );
  };

  const withSolution = (shouldAccept, carried) => {
    if (!state.syncSolution) {
      return carried;
    }
    // discourse-solved only applies in categories where it is switched on.
    if (shouldAccept && !state.solutionHere) {
      return carried || t("notice.solution_not_here");
    }
    if (shouldAccept && !state.solution) {
      return acceptSolution(post).then(
        () => {
          setPostField(post, "accepted_answer", true);
          return carried;
        },
        (error) => carried || withReason(t("notice.solution_failed"), error)
      );
    }
    if (!shouldAccept && state.solution) {
      return unacceptSolution(post).then(
        () => {
          setPostField(post, "accepted_answer", false);
          return carried;
        },
        (error) => carried || withReason(t("notice.solution_failed"), error)
      );
    }
    return carried;
  };

  // Marking the reply as the solution is the point of a thumbs up; the like is
  // a visible side effect and must not be able to fail the action.
  const saveUp = (note) =>
    run(() =>
      // withSolution resolves to a notice or to nothing, and may answer
      // without going to the server at all.
      Promise.resolve(withSolution(true, null))
        .then((carried) => like(post, site).then(() => setActed(post, typeId(site, "like"), true), () => null).then(() => carried))
        .then((carried) => (note && state.canNote ? saveNote(TAG.up, "up", note, carried) : carried))
    );

  bar.querySelector(".js-up")?.addEventListener("click", () => {
    if (state.solution || state.liked) {
      return run(() =>
        Promise.resolve(withSolution(false, null)).then((carried) =>
          unlike(post, site).then(
            () => {
              setActed(post, typeId(site, "like"), false);
              return carried;
            },
            () => carried
          )
        )
      );
    }
    return state.canNote ? redraw("up") : saveUp("");
  });

  bar.querySelector(".js-down")?.addEventListener("click", () => {
    if (state.downNote) {
      return run(() =>
        removePost(state.downNote.id).then(
          () => {
            setPostField(state.downNote, "deleted_at", new Date().toISOString());
            return null;
          },
          (error) => withReason(t("notice.undo_failed"), error)
        )
      );
    }
    return redraw("down");
  });

  const takeOutOfView = (carried) => {
    if (!settings.hide_on_review) {
      return carried;
    }
    return removePost(post.id).then(
      () => {
        setPostField(post, "deleted_at", new Date().toISOString());
        return carried;
      },
      (error) => carried || withReason(t("notice.hide_failed"), error)
    );
  };

  bar.querySelector(".js-review")?.addEventListener("click", () => {
    if (state.hidden) {
      return run(() =>
        restorePost(post.id).then(() => {
          setPostField(post, "deleted_at", null);
          setPostField(post, "hidden", false);
        })
      );
    }
    return redraw("review");
  });

  bar.querySelector(".js-cancel")?.addEventListener("click", () => redraw());

  bar.querySelector(".js-save")?.addEventListener("click", () => {
    const note = (bar.querySelector(".js-text")?.value || "").trim();

    if (mode === "up") {
      return saveUp(note);
    }

    const tag = mode === "review" ? TAG.review : TAG.down;

    return run(() =>
      Promise.resolve(saveNote(tag, mode, note, null))
        .then((carried) => (mode === "review" ? takeOutOfView(carried) : carried))
        .then((carried) => withSolution(false, carried))
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
    userId: currentUser.id,
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
