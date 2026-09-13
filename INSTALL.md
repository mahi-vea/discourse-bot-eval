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
| Is the group **moderators**? | Admin → Groups → your group | Needed to write notes and to remove a reply. Without it 👍 still marks solutions; the bar explains what it could not do. |
| Are **whispers** enabled? | Admin → Settings, search `whispers` | Needed for every written note. The bar says so rather than losing what you typed. |
| Is **discourse-solved** installed? | Admin → Plugins | 👍 then only likes. The component detects this and stops mentioning solutions. |
| Are **solutions enabled in the category**? | the category → Settings → *Allow topic owner and staff to mark a reply as the solution* | **The most common reason 👍 does not mark the solution.** Tick it per category, or set `allow_solved_on_all_topics`. |

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

The first two are the ones that matter: **while either is empty, the component does nothing
at all, for everybody.** That is deliberate — there is no way to half-configure it into
showing buttons to the wrong people.

Settings save immediately. No rebuild.

## 5. Check it works

1. Log in as someone in `eyantra_staff` and open a topic where the bot has replied.
2. Under the bot's reply: **Bot reply:** 👍 Good · 👎 Needs work · 🚫 Mark for review.
   Under a *person's* reply: nothing. That is the point.
3. Press 👍 and save with the box empty. The reply should be **marked as the solution** and
   gain a like. If it only gains a like, read the pink notice in the bar — it names the
   reason, usually solutions not being enabled for that category.
4. Press 👍 again. The solution and the like should both come off.
5. Press 👎, type a reason, save. A staff-only whisper appears in the topic, and 👎 lights up.
6. Press 👎 again — the whisper is deleted and the button goes dark. (This is the undo.)
7. Press 🚫, type a reason, save. The reply disappears from the topic for members.
8. Open the same topic in a **private window, logged out**. The reply should be gone.
9. Press **Put back** to restore it.

Do this on one throwaway topic first. Every step is reversible, and none of it puts anything
in front of your other moderators.

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
| 👍 Good | **accepts the solution**, and likes the post | the solution badge on the topic |
| 👎 Needs work | a **staff-only whisper** tagged `[bot-eval:needs-work]` | in the topic, staff only |
| 🚫 Mark for review | a whisper tagged `[bot-eval:review]`, then **deletes the reply** | the reply shows as deleted to moderators, and is gone for members |

**No flags are ever raised.** A flag is scored against the account it is raised on, and
enough of them can silence a low-trust bot account; flags also cannot be retracted once
acted on. Everything above undoes with one click and leaves the bot's standing untouched.

So everything is visible and reversible through the normal moderation tools, with or without
this component installed.

## Reading the results later

- **Every written note** is a staff-only whisper tagged `[bot-eval:good]`,
  `[bot-eval:needs-work]` or `[bot-eval:review]`. Searching the forum for `bot-eval` as a
  moderator finds them all.
- **The good replies** are the ones marked as their topic's solution.
- **The pulled replies** are deleted posts.

[EXPORT.md](EXPORT.md) has the queries.

## Updating

- Installed from git: Admin → Customize → Themes → the component → **Check for updates**.
- Installed from a zip: re-zip and install again over it.

## Removing it

Admin → Customize → Themes → the component → **Delete**. The buttons disappear at once.

Everything already recorded stays exactly where it is — likes, whispers, solutions and
deletions are ordinary Discourse data and do not belong to this component. **Replies you
pulled stay deleted**, so put back anything still on hold before you remove the component,
or restore them afterwards from the topic as a moderator.
