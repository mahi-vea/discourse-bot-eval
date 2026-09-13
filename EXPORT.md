# Getting the data out

The component writes nothing of its own — every rating is an ordinary Discourse like,
accepted solution, staff-only whisper or deleted post. That is what makes it installable
without a plugin, and it is also the catch: there is no `bot_evaluations` table to select
from, and **a 👍 from the bar is indistinguishable from a like somebody gave the normal way.**

So every query below filters on two things: *the post was written by the bot*, and *the
rating came from someone in the evaluator group*. Do not skip the second filter — without it
you are counting members' likes as staff evaluations.

## Where each rating lives

| Rating | Stored as | Find it by |
| --- | --- | --- |
| 👍 Good | the topic's **accepted solution**, plus a like | `discourse_solved_solved_topics`, or `post_actions` type `like` |
| 👎 Needs work | a **staff-only whisper** | `posts` where `post_type = 4` and the raw starts `[bot-eval:needs-work]` |
| 🚫 Mark for review | a whisper, plus the reply **deleted** | `[bot-eval:review]`, and `posts.deleted_at is not null` |
| any note | the whisper's text after the tag | same |

Nothing is ever flagged, so **the Review queue is not part of this** — ignore it.

## 1. Just read it — no setup

Search the forum as a moderator for `bot-eval`. Every note comes back, each one a staff-only
whisper sitting under the reply it is about. `[bot-eval:needs-work]` is the one worth reading
first.

## 2. Data Explorer — the one to use if you can

Admin → Plugins. If **discourse-data-explorer** is listed you can run SQL and press
**Download CSV** or **JSON**. It is another plugin, so you cannot install it yourself — but
it is very commonly already present, and it turns this whole document into four queries.

> Before trusting a query, run `SELECT id, name_key FROM post_action_types;` once to confirm
> the like type id on your version. Everything else here uses `posts` and `topics`, whose
> columns have been stable for years.

Set these once at the top of each query:

```sql
-- the bot, and the group whose ratings count
WITH bot AS (SELECT id FROM users WHERE username_lower = 'rag_bot'),
     evaluators AS (
       SELECT gu.user_id
       FROM group_users gu
       JOIN groups g ON g.id = gu.group_id
       WHERE g.name = 'eyantra_staff'
     )
```

### Every 👍, with who gave it

```sql
WITH bot AS (SELECT id FROM users WHERE username_lower = 'rag_bot'),
     evaluators AS (
       SELECT gu.user_id FROM group_users gu
       JOIN groups g ON g.id = gu.group_id WHERE g.name = 'eyantra_staff'
     )
SELECT pa.created_at,
       u.username            AS evaluator,
       t.title               AS question,
       p.raw                 AS bot_answer,
       '/t/' || t.id || '/' || p.post_number AS link
FROM post_actions pa
JOIN posts p  ON p.id = pa.post_id
JOIN topics t ON t.id = p.topic_id
JOIN users u  ON u.id = pa.user_id
JOIN post_action_types pat ON pat.id = pa.post_action_type_id
WHERE pat.name_key = 'like'
  AND p.user_id IN (SELECT id FROM bot)
  AND pa.user_id IN (SELECT user_id FROM evaluators)
  AND pa.deleted_at IS NULL
ORDER BY pa.created_at DESC
```

### Every note, with who wrote it and what it was about

```sql
WITH bot AS (SELECT id FROM users WHERE username_lower = 'rag_bot')
SELECT w.created_at,
       u.username AS evaluator,
       CASE
         WHEN w.raw LIKE '[bot-eval:good]%'       THEN 'good'
         WHEN w.raw LIKE '[bot-eval:needs-work]%' THEN 'needs work'
         WHEN w.raw LIKE '[bot-eval:review]%'     THEN 'pulled for review'
       END AS verdict,
       regexp_replace(w.raw, '^\[bot-eval:[a-z-]+\]\s*', '') AS note,
       t.title     AS question,
       p.raw       AS bot_answer,
       p.deleted_at IS NOT NULL AS reply_removed,
       '/t/' || t.id || '/' || p.post_number AS link
FROM posts w
JOIN topics t ON t.id = w.topic_id
JOIN users u  ON u.id = w.user_id
LEFT JOIN posts p
       ON p.topic_id = w.topic_id AND p.post_number = w.reply_to_post_number
WHERE w.post_type = 4                       -- whisper
  AND w.raw LIKE '[bot-eval:%'
  AND w.deleted_at IS NULL                  -- an undone rating is deleted
  AND (p.user_id IS NULL OR p.user_id IN (SELECT id FROM bot))
ORDER BY w.created_at DESC
```

This one query covers all three buttons. `w.deleted_at IS NULL` matters: pressing 👎 again
deletes the whisper, which is how a rating is taken back.

### Replies currently pulled out of public view

```sql
WITH bot AS (SELECT id FROM users WHERE username_lower = 'rag_bot')
SELECT p.deleted_at, t.title AS question, p.raw AS bot_answer,
       '/t/' || t.id || '/' || p.post_number AS link
FROM posts p
JOIN topics t ON t.id = p.topic_id
WHERE p.user_id IN (SELECT id FROM bot)
  AND p.deleted_at IS NOT NULL
ORDER BY p.deleted_at DESC
```

### One row per rated reply — the training-set query

```sql
WITH bot AS (SELECT id FROM users WHERE username_lower = 'rag_bot'),
     evaluators AS (
       SELECT gu.user_id FROM group_users gu
       JOIN groups g ON g.id = gu.group_id WHERE g.name = 'eyantra_staff'
     )
SELECT t.title AS question,
       (SELECT raw FROM posts WHERE topic_id = t.id AND post_number = 1) AS asked,
       p.raw  AS bot_answer,
       p.hidden,
       COUNT(DISTINCT pa.id) FILTER (WHERE pat.name_key = 'like') AS thumbs_up,
       COUNT(DISTINCT w.id) FILTER (WHERE w.raw LIKE '[bot-eval:needs-work]%') AS needs_work,
       '/t/' || t.id || '/' || p.post_number AS link,
       p.created_at
FROM posts p
JOIN topics t ON t.id = p.topic_id
LEFT JOIN post_actions pa
       ON pa.post_id = p.id AND pa.deleted_at IS NULL
      AND pa.user_id IN (SELECT user_id FROM evaluators)
LEFT JOIN post_action_types pat ON pat.id = pa.post_action_type_id
LEFT JOIN posts w
       ON w.topic_id = p.topic_id AND w.reply_to_post_number = p.post_number
      AND w.post_type = 4 AND w.deleted_at IS NULL AND w.raw LIKE '[bot-eval:%'
WHERE p.user_id IN (SELECT id FROM bot)
  AND p.deleted_at IS NULL
GROUP BY t.id, p.id
ORDER BY p.created_at DESC
```

`thumbs_up > 0` is a good answer, `needs_work > 0` is a bad one, and a non-null `deleted_at`
is one somebody pulled and you should look at first.

### Pulling a saved query on a schedule

Save the query, note its id from the URL, then:

```bash
curl -s -X POST \
  -H "Api-Key: $KEY" -H "Api-Username: system" \
  "$FORUM/admin/plugins/explorer/queries/42/run.json?format=json" -o ratings.json
```

---

## 3. The REST API — no Data Explorer needed

Make an admin key first: **Admin → API → Keys → New API Key**, scope *Global*.

```bash
export FORUM=https://forum.e-yantra.org
export KEY=your_api_key_here
AUTH=(-H "Api-Key: $KEY" -H "Api-Username: system")
```

### The notes

Nothing here needs the Review queue. Search finds the whispers, as a moderator's key:

```bash
curl -s "${AUTH[@]}" "$FORUM/search.json?q=bot-eval" -o notes.json
jq '.posts[] | {id, topic_id, blurb}' notes.json
```

Search results are capped and blurred, so this is a way to *find* the notes, not to export
them wholesale. For that, use Data Explorer above or the backup below.

### The 👍s on one topic

```bash
curl -s "${AUTH[@]}" "$FORUM/t/990.json" \
  | jq '.post_stream.posts[]
        | select(.username=="rag_bot")
        | {post: .post_number,
           likes: (.actions_summary[]? | select(.id==2) | .count // 0)}'
```

To enumerate the bot's topics in the first place, `GET /search.json?q=%40rag_bot` works, or
walk `/u/rag_bot/activity.json`. Both paginate, and neither is as pleasant as one SQL query —
which is why Data Explorer is worth asking for.

---

## 4. The guaranteed fallback — a site backup

Every admin can do this, and it needs no plugin and no API:

**Admin → Backups → Backup** (tick *include uploads* only if you want them), download the
`.tar.gz`, then locally:

```bash
tar -xzf forum-backup.tar.gz
psql -d scratch -f dump.sql
```

Now run any query from section 2 against your own copy. Slow, large, and completely
dependable — good for a one-off training-set build, wrong for a weekly check.

---

## Turning it into training data

The shape worth aiming for, since it carries both the verdict and the human reasoning:

```json
{
  "question": "When is the eYRC 2026 Task 2 deadline?",
  "asked": "I can't find the Task 2 deadline anywhere...",
  "bot_answer": "The deadline for Task 2 is ...",
  "verdict": "bad",
  "reason": "quoted last year's deadline",
  "evaluator": "asha",
  "hidden": true,
  "link": "https://forum.e-yantra.org/t/.../990/4",
  "rated_at": "2026-09-13T09:14:22Z"
}
```

The bad ones are worth more than the good ones: a 👎 with a written reason tells you what to
fix, while a 👍 only tells you not to break something. Pull `verdict = bad` first.

## What you cannot get this way

Worth knowing before you build anything on top of it:

- **Notes are matched to replies by `reply_to_post_number`.** Usually right, not guaranteed —
  if someone edits a whisper's reply target, the link breaks.
- **A like is public**, and so is an accepted solution. The written notes are staff-only, but
  the fact that a reply was rated good is visible to everyone.
- **A member's like looks the same as an evaluator's.** Hence the group filter in every query.
- **Un-doing is lossy.** Taking back a 👎 deletes the whisper; taking back a 👍 deletes the
  like row. You lose the fact that it ever existed. The plugin version keeps that history in
  a table of its own; this one cannot.
- **Deleted replies can eventually be purged.** Discourse cleans up long-deleted posts, so a
  reply left pulled for months may not be recoverable forever. Put things back, or fix them,
  within a reasonable time.

If any of those matter, that is the argument for asking whoever hosts the forum to install
the plugin version instead, which stores one row per rating with the note attached and never
deletes the history.
