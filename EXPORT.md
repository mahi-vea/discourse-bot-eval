# Getting the data out

The component writes nothing of its own — every rating is an ordinary Discourse like, flag or
whisper. That is what makes it installable without a plugin, and it is also the catch: there
is no `bot_evaluations` table to select from, and **a 👍 from the bar is indistinguishable
from a like somebody gave the normal way.**

So every query below filters on two things: *the post was written by the bot*, and *the
rating came from someone in the evaluator group*. Do not skip the second filter — without it
you are counting members' likes as staff evaluations.

## Where each rating lives

| Rating | Stored as | Table | Read it at |
| --- | --- | --- | --- |
| 👍 Good | a like | `post_actions`, type `like` | the post itself |
| 👍 note | a staff-only whisper | `posts` with `post_type = 4` | the topic, staff view |
| 👎 Needs work | a flag + its message | `post_actions` + `reviewables` | `/review?status=all` |
| 🚫 Mark for review | the same flag, `staff_took_action` | same | `/review?status=all`, post hidden |

---

## 1. Just read it — no setup

`https://your-forum/review?status=all`

Every 👎 and 🚫, with the note the evaluator wrote, who wrote it, and a link to the reply.
Filter by type *Flagged Post*. This is the fastest way to answer "what is the bot getting
wrong this week", and needs nothing installed.

What it will not show you: the 👍s, or the whispered notes on them.

---

## 2. Data Explorer — the one to use if you can

Admin → Plugins. If **discourse-data-explorer** is listed you can run SQL and press
**Download CSV** or **JSON**. It is another plugin, so you cannot install it yourself — but
it is very commonly already present, and it turns this whole document into four queries.

> Before trusting a query, run `SELECT * FROM reviewable_scores LIMIT 5;` and
> `SELECT id, name_key FROM post_action_types;` once. Column names around flags have moved
> between Discourse versions, and it is better to find that out on a `LIMIT 5` than halfway
> through an export.

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

### Every 👎 and 🚫, with the reason that was written

The flag's message is not on the flag: Discourse files it as the first post of a private
message to the moderators, which `reviewable_scores` points at.

```sql
WITH bot AS (SELECT id FROM users WHERE username_lower = 'rag_bot')
SELECT rs.created_at,
       u.username  AS evaluator,
       CASE WHEN p.hidden THEN 'marked for review' ELSE 'needs work' END AS verdict,
       reason.raw  AS reason,
       t.title     AS question,
       p.raw       AS bot_answer,
       '/t/' || t.id || '/' || p.post_number AS link
FROM reviewable_scores rs
JOIN reviewables r ON r.id = rs.reviewable_id
JOIN posts p   ON p.id = r.target_id AND r.target_type = 'Post'
JOIN topics t  ON t.id = p.topic_id
JOIN users u   ON u.id = rs.user_id
LEFT JOIN posts reason
       ON reason.topic_id = rs.meta_topic_id AND reason.post_number = 1
WHERE p.user_id IN (SELECT id FROM bot)
ORDER BY rs.created_at DESC
```

If `rs.meta_topic_id` does not exist on your version, drop the `LEFT JOIN` and read the
reasons from `/review` instead — everything else in the query still works.

### The notes written on a 👍

```sql
WITH bot AS (SELECT id FROM users WHERE username_lower = 'rag_bot')
SELECT w.created_at, u.username AS evaluator, w.raw AS note,
       t.title AS question,
       '/t/' || t.id AS link
FROM posts w
JOIN topics t ON t.id = w.topic_id
JOIN users u  ON u.id = w.user_id
WHERE w.post_type = 4                    -- whisper
  AND w.raw LIKE 'Bot reply evaluation — good:%'
  AND w.deleted_at IS NULL
ORDER BY w.created_at DESC
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
       COUNT(DISTINCT r.id)  AS flags,
       '/t/' || t.id || '/' || p.post_number AS link,
       p.created_at
FROM posts p
JOIN topics t ON t.id = p.topic_id
LEFT JOIN post_actions pa
       ON pa.post_id = p.id AND pa.deleted_at IS NULL
      AND pa.user_id IN (SELECT user_id FROM evaluators)
LEFT JOIN post_action_types pat ON pat.id = pa.post_action_type_id
LEFT JOIN reviewables r ON r.target_id = p.id AND r.target_type = 'Post'
WHERE p.user_id IN (SELECT id FROM bot)
  AND p.deleted_at IS NULL
GROUP BY t.id, p.id
ORDER BY p.created_at DESC
```

`thumbs_up > 0` is a good answer, `flags > 0` is a bad one, `hidden` is one you should look
at first.

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

### The 👎 and 🚫 reasons

```bash
curl -s "${AUTH[@]}" "$FORUM/review.json?status=all&type=ReviewableFlaggedPost" -o review.json
```

Response shapes differ between versions, so look before you script against it:

```bash
jq 'keys' review.json
jq '.reviewables[0]' review.json
```

Then page through with `&page=2`, `&page=3` … until `reviewables` comes back empty.

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

- **A like carries no text.** The only note on a 👍 is the whisper, and matching whispers back
  to the exact post they were about relies on `reply_to_post_number` — usually right, not
  guaranteed.
- **Ratings are not private.** A like is public, and the bot's author sees it. A flag is
  visible to all moderators. Nothing here is a quiet internal note.
- **A member's like looks the same as an evaluator's.** Hence the group filter in every query.
- **Un-doing is lossy.** If someone takes a 👍 back, the like row is deleted — you lose the
  fact that it ever existed. The plugin version keeps that history; this one cannot.

If any of those matter, that is the argument for asking whoever hosts the forum to install
the plugin version instead, which stores one row per rating with the note attached and never
deletes the history.
