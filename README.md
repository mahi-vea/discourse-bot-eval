# Bot reply evaluation — theme component

Lets a trusted group rate your answer bot's replies, and pull a bad one out of public view —
**without installing a plugin**. Install it yourself from the admin panel in about two
minutes. No server access, no rebuild, no downtime, one click to remove.

On every reply written by the configured bot account, members of the configured group see a
bar under the post:

| Action | Note | What it actually does in Discourse |
| --- | --- | --- |
| 👍 **Good** | optional | **Accepts the reply as the topic's solution**, and likes it. A note is kept as a staff-only whisper. |
| 👎 **Needs work** | optional | Writes your reason as a **staff-only whisper** that members never see. Withdraws the solution. |
| 🚫 **Mark for review** | optional | Writes the reason as a whisper and **deletes the reply** — gone for members, still visible to moderators. One click puts it back. |

**Nothing here flags anything.** Flags are scored against the account they are raised on and
can trip Discourse's auto-silence thresholds, which would eventually silence your bot; they
also cannot be retracted once a moderator has acted on them. Likes, whispers and deletions
carry no penalty and every one of them undoes cleanly.

Notes are never mandatory — the hint above the box asks for one and says where it will end
up, but Save always works. When you leave the box empty the note simply records that no
reason was given.

## Why it works this way

A theme component is browser-side only: it cannot add database tables, routes or permissions.
So instead of inventing storage, every rating is recorded through **Discourse's own API, as
the signed-in user**. Discourse authenticates and authorises each call itself, which means
none of it can be forged by editing this component in a browser — the worst a determined
person can do is like a post, or — if they are a moderator — whisper and delete, which they
can already do from the normal UI.

It also means nothing ever leaves your forum, there is no endpoint to run, no CORS, and no
API token living in a theme setting where every visitor could read it.

## Install

Step by step, including what to check when the bar does not appear, is in
**[INSTALL.md](INSTALL.md)**. The short version:

1. **Admin → Customize → Themes → Install → From a git repository** (or upload a zip).
2. Open your **default theme** → **Components** → **Add** → this component. It does nothing
   until it is attached to a theme — this is the step people miss.
3. Fill in `bot_usernames` and `evaluator_groups` in its settings.

To update: **Check for updates** on the component. To remove: delete it — already-recorded
likes, whispers and deletions are ordinary Discourse data and stay put.

## Configure

Open the component and press **Settings**:

| Setting | Value |
| --- | --- |
| `bot_usernames` | the bot's username, e.g. `eyantra_bot` (several allowed) |
| `evaluator_groups` | `eyantra_staff` |
| `hide_on_review` | ✅ delete the reply on Mark for review — needs moderator rights |
| `mark_solution_on_good` | ✅ (ignored when the Solved plugin is absent) |

**Both lists start empty on purpose: until you name a bot *and* a group, nothing appears
anywhere.**

Three things the forum must already have:

- **Moderator rights** for the group — required to whisper and to delete a reply. Without
  them the bar still marks solutions and likes, and says plainly why the rest did not work.
- **Whispers enabled** (`enable_whispers` / `whispers_allowed_groups`), or written notes have
  nowhere to live. The bar says so rather than losing what you typed.
- **Solutions switched on in the category** (Discourse's per-category *"Allow topic owner and
  staff to mark a reply as the solution"*), or 👍 cannot mark anything. **This is the most
  common reason a thumbs up does not mark the solution.**

## Solutions

"Accept as solution" comes from the **discourse-solved plugin**, which is itself a plugin — a
theme cannot install it. Check Admin → Plugins: if `discourse-solved` is listed (it ships
with Discourse's own hosting and is very widely installed), the solution behaviour works.
The component **detects it at runtime** and, when it is absent, silently skips it and stops
mentioning solutions in the hints.

What works: 👍 accepts the reply as the solution; taking the 👍 back, a 👎, or marking for
review withdraws it.

**What does not work here:** the reverse direction — somebody pressing Discourse's *own*
"Solution" button and having that recorded as a 👍. That needs a server-side event hook, so
it exists only in the plugin version. The bar does show the current solution state, so you
can see it; it just will not write a like for it.

## Reading the results

- **Every written note is a staff-only whisper** in the topic it belongs to, tagged so it can
  be found in one query: `[bot-eval:good]`, `[bot-eval:needs-work]` or `[bot-eval:review]`.
- **The 👍s are likes** on the bot's posts, and the good replies are the topic's accepted
  solutions.
- **The pulled replies are deleted posts** — `posts.deleted_at is not null`.

Full instructions — Data Explorer queries, the REST API, and a backup as the guaranteed
fallback — are in **[EXPORT.md](EXPORT.md)**, including the one trap worth knowing up front:
a 👍 from the bar is an ordinary like, so every query has to filter on the evaluator group or
you will count members' likes as staff ratings.

This is the real cost of Route B: the ratings live in Discourse's own tables rather than next
to your training data, so you pull them on a schedule instead of receiving them live.

## Before you trust it

Three of the API calls should be confirmed against your forum's Discourse version on the
first run — they are the ones that differ most between releases:

| Call | Used for | If it fails |
| --- | --- | --- |
| `POST /solution/accept` and `/solution/unaccept` | 👍 marking the solution | the bar shows **the server's own error message**, and the like still lands |
| `POST /posts` with `whisper: true` | every written note | the bar says the note could not be saved; the rating itself stands |
| `DELETE /posts/:id` and `PUT /posts/:id/recover` | mark for review | the bar says the reply could not be removed, and does not pretend otherwise |

Each step reports itself separately, so a failure never silently costs you the part that did
work. When a solution cannot be accepted because the category has solutions switched off,
the component says exactly that instead of trying and failing.

Group membership is resolved defensively too: from the current user if the browser was told,
otherwise from the user's own profile endpoint, cached for the tab. If that lookup fails the
component **fails closed** — no bar — rather than showing the buttons to the wrong people.

## Tests

```bash
./test/run.sh
```

59 tests, needing only Ruby and Node — no Discourse, no database, a couple of seconds. The
harness loads the **real** `bot-eval.js` with Discourse's imports rewritten to stubs, so what
runs is the shipped file. Covered: who sees the bar and on which posts, every button mapped
to the exact API call and payload it should send, optional notes and their stand-in messages,
take-action hiding, solution handling with and without the Solved plugin, soft failures, and
the consistency of `settings.yml`, `about.json` and the locale file with the script.

One test asserts that every URL the component calls is a path on the forum itself — nothing
is ever sent anywhere else.
