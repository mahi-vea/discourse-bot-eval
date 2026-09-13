# Installing

You do this yourself, from the admin panel. No server access, no rebuild, no downtime.
About five minutes, and one click to undo.

---

## Before you start

| You need | How to check |
| --- | --- |
| An **admin** account on the forum | You can see Admin → Customize → Themes |
| The **bot's exact username** | Open one of its replies and click its avatar — the username is in the URL |
| The **group name** for your evaluators | Admin → Groups, e.g. `eyantra_staff` (the name, not the display title) |

Three things about the forum decide how much of the component works. Check them now — each
one has a fallback, so nothing here is a blocker:

| Check | Where | If it's missing |
| --- | --- | --- |
| Is the group **moderators**? | Admin → Groups → your group | Turn `hide_on_review` off in step 4. "Mark for review" then sends the reply to the Review queue instead of hiding it. |
| Are **whispers** enabled? | Admin → Settings, search `whispers` | Turn `good_note_as_whisper` off in step 4. The note box disappears from 👍. |
| Is **discourse-solved** installed? | Admin → Plugins | Nothing to do. The component detects it and skips the solution behaviour silently. |

---

## 1. Package the component

**If you have a git repository** (GitHub, or anything the forum can reach over HTTPS), push
this directory to it and skip to step 2:

```bash
cd discourse-bot-eval-theme
git init
git add .
git commit -m "Bot reply evaluation theme component"
git remote add origin https://github.com/eyantra/discourse-bot-eval-theme.git
git push -u origin main
```

**If you would rather not**, make a zip instead — Discourse installs those too:

```bash
cd discourse-bot-eval-theme
zip -r ../bot-eval-theme.zip . -x 'test/*' '.git/*' '.gitignore' 'INSTALL.md'
```

`about.json` must sit at the top level of the zip, which is what the command above produces.
The `test/` folder is excluded because the forum has no use for it.

> A git repository is worth the trouble if you can: Discourse will then show an **update**
> button whenever you push a change, instead of you re-uploading a zip each time.

## 2. Install it

**Admin → Customize → Themes → Install**, then either:

- **From a git repository** — paste the repository URL, press Install
- **From your device** — choose `bot-eval-theme.zip`

It appears in the left-hand list, under **Components** rather than Themes. That is correct —
`about.json` declares it a component.

## 3. Attach it to your theme

**This is the step people miss.** A component does nothing on its own; it has to be added to
the theme the forum actually uses.

1. In the left-hand list, click your active theme (the one marked **default**), not the
   component.
2. Scroll to **Components**.
3. **Add** → pick *Bot reply evaluation*.

If your forum offers members a choice of themes, add it to each one you want it active in.

## 4. Settings

Click the component in the list, then **Settings**:

| Setting | Set it to |
| --- | --- |
| `bot_usernames` | the bot's username, e.g. `eyantra_bot`. Several allowed, one per line |
| `evaluator_groups` | `eyantra_staff`. Several allowed, one per line |
| `hide_on_review` | ✅ — **off** if your group are not moderators |
| `mark_solution_on_good` | ✅ — ignored if discourse-solved is not installed |
| `good_note_as_whisper` | ✅ — **off** if whispers are disabled |

The first two are the ones that matter: **while either is empty, the component does nothing
at all, for everybody.** That is deliberate — there is no way to half-configure it into
showing buttons to the wrong people.

Settings save immediately. No rebuild.

## 5. Check it works

1. Log in as someone in `eyantra_staff` and open a topic where the bot has replied.
2. Under the bot's reply: **Bot reply:** 👍 Good · 👎 Needs work · 🚫 Mark for review.
   Under a *person's* reply: nothing. That is the point.
3. Press 👍 and save with the box empty. The post should gain a like.
4. Press 👎, type a reason, save. Open `https://your-forum/review` — your reason is there.
5. Press 🚫, type a reason, save. The reply should be marked hidden.
6. Open the same topic in a **private window, logged out**. The hidden reply should be gone.
7. Press **Un-hide** to put it back.

Do this on one throwaway topic first. Everything in step 5 is reversible, but a flag does
appear in the Review queue for your moderators to see.

## If the bar does not appear

Work down this list — it is almost always one of the first three.

| Check | How |
| --- | --- |
| Is the component **attached to your theme**? | Admin → Customize → Themes → your default theme → Components |
| Is the **bot username** spelled exactly right? | Compare with the bot's profile URL. Case does not matter; spelling does |
| Are **you** in the group? | Admin → Groups → your group → Members |
| Is it the **bot's** post? | The bar never appears on a person's post, by design |
| Browser cache | Hard refresh: Ctrl+Shift+R |
| Anything in the console? | F12 → Console, reload the page, look for red |

Group membership is handled for you: if your Discourse version does not send the viewer's
groups to the browser, the component asks the user's own profile endpoint instead and
remembers the answer for the rest of the tab. On a slow connection the bar can therefore
appear a moment after the page does. If that lookup fails it shows **no** bar rather than
guessing — so a missing bar is never a permissions leak.

If everything above checks out and the bar is still missing, open the console (F12), reload,
and look for a failed request to `/u/<your-username>.json`.

## What each button actually does

Nothing is stored by this component — it drives Discourse's own features:

| Button | Discourse action | Where it shows up |
| --- | --- | --- |
| 👍 Good | a **like** (+ a staff-only **whisper** for the note, + accepts the **solution**) | on the post; the whisper in the topic, staff-only |
| 👎 Needs work | a **flag** carrying your note | Admin → Review queue |
| 🚫 Mark for review | the same flag **with "take action"** | the reply is hidden; the flag is in the Review queue |

So everything is visible and reversible through the normal moderation tools, with or without
this component installed.

## Reading the results later

- **The 👎 reasons**: `https://your-forum/review?status=all` — the note, who wrote it, and a
  link to the reply.
- **The 👍s**: likes on the bot's posts.
- **The 👍 notes**: whispers in the topic, each beginning *"Bot reply evaluation — good:"*.

## Updating

- Installed from git: Admin → Customize → Themes → the component → **Check for updates**.
- Installed from a zip: re-zip and install again over it.

## Removing it

Admin → Customize → Themes → the component → **Delete**. The buttons disappear at once.

Everything already recorded stays exactly where it is — likes, flags and whispers are
ordinary Discourse data and do not belong to this component. **Replies you hid stay hidden**,
so un-hide anything still on hold before you delete it, or clear them afterwards from the
Review queue.
