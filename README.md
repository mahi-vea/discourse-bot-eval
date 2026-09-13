# Bot reply evaluation — theme component

Lets a trusted group rate your answer bot's replies, and pull a bad one out of public view —
**without installing a plugin**. Install it yourself from the admin panel in about two
minutes. No server access, no rebuild, no downtime, one click to remove.

On every reply written by the configured bot account, members of the configured group see a
bar under the post:

| Action | Note | What it actually does in Discourse |
| --- | --- | --- |
| 👍 **Good** | optional | **Likes** the post. A note is posted as a staff-only **whisper**. Accepts it as the topic's **solution**. |
| 👎 **Needs work** | optional | **Flags** the post ("Something Else") with your note, which lands in the **Review queue**. Withdraws the solution. |
| 🚫 **Mark for review** | optional | The same flag **with "take action"**, which **hides the reply immediately**. Withdraws the solution. |

Notes are never mandatory — the hint above the box asks for one and says where it will end
up, but Save always works. A flag needs a message to be accepted by Discourse, so when you
leave the box empty a plain stand-in message is sent in its place.

## Why it works this way

A theme component is browser-side only: it cannot add database tables, routes or permissions.
So instead of inventing storage, every rating is recorded through **Discourse's own API, as
the signed-in user**. Discourse authenticates and authorises each call itself, which means
none of it can be forged by editing this component in a browser — the worst a determined
person can do is like or flag a post, which they can already do from the normal UI.

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
likes and flags are ordinary Discourse data and stay put.

## Configure

Open the component and press **Settings**:

| Setting | Value |
| --- | --- |
| `bot_usernames` | the bot's username, e.g. `eyantra_bot` (several allowed) |
| `evaluator_groups` | `eyantra_staff` |
| `hide_on_review` | ✅ hide immediately — needs the evaluator to be a moderator |
| `mark_solution_on_good` | ✅ (ignored when the Solved plugin is absent) |
| `good_note_as_whisper` | ✅ — switch off to drop the note box on 👍 |

**Both lists start empty on purpose: until you name a bot *and* a group, nothing appears
anywhere.**

Two things the forum must already have:

- **Moderator rights** for the group, or "Mark for review" cannot hide anything. With
  `hide_on_review` off it still raises the reply in the Review queue for a moderator to
  action.
- **Whispers enabled** (`enable_whispers` / `whispers_allowed_groups`), or a note on 👍 has
  nowhere to go. Without it, turn `good_note_as_whisper` off.

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

- **The 👎 reasons are in the Review queue**: `https://your-forum/review?status=all` —
  every flag with the note the evaluator wrote, who wrote it, and a link to the reply. This
  is the one you want for fixing the bot.
  Via the API: `GET /review.json?status=all&type=ReviewableFlaggedPost`, with an admin
  `Api-Key` / `Api-Username` header.
- **The 👍s are likes** on the bot's posts. A topic's JSON (`GET /t/<id>.json`) carries each
  post's `actions_summary` with the like count. If the **Data Explorer** plugin is available,
  one SQL query over `post_actions` where `post_action_type_id = 2` and the bot's `user_id`
  gives you the lot in one go.
- **The 👍 notes are whispers** in the topic, each starting with *"Bot reply evaluation —
  good:"*, visible to staff only.

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
| `POST /posts` with `whisper: true` | the note on 👍 | the like still lands, and the bar says the note could not be whispered |
| `POST /solution/accept` and `/solution/unaccept` | solutions | the rating still lands, and the bar says the solution could not be changed |
| `PUT /posts/:id/unhide` | the Un-hide button | you get the usual error; un-hide from the Review queue instead |

The first two are deliberately "soft": a failure there never costs you the rating, and it is
reported in the bar rather than swallowed. The note box on 👍 is not even offered unless the
viewer is staff and whispers are available, so the common case never arises.

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
