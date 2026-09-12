# Preference API — the AI-facing interface to the scheduler

**Audience note, read this before anything else below:** this document is written for
whatever has tool-calling access to this system and *no other context* — no access to
`backend/optimizer/`'s source, no memory of how these numbers were arrived at, none of
the trial and error that produced them. If you are a model reading this as part of a
tool declaration, or an engineer wiring one up, everything you need should be on this
page. Where something is a rule rather than a suggestion, it's written as one.

Companion file: [`backend/optimizer/tool_schemas.json`](backend/optimizer/tool_schemas.json)
is the paste-ready version of every tool below, as standard JSON-Schema function
declarations (Gemini/OpenAI/Claude-compatible). The two are meant to stay in sync by
hand; this document is the *why*, that file is the *exact contract*.

---

## 1. The mental model, in one paragraph

A student's calendar is produced by a CP-SAT solver (Google OR-Tools), not by a
language model. The model never edits the schedule and never touches solver code —
every tool call below does exactly one thing: it produces one typed
`{type, value, weight}` preference object, which a fixed, deterministic Python
compiler (never the model) turns into either a hard rule or a weighted term the solver
optimizes against. A chat message can trigger zero, one, or several tool calls; each
one lands in the `preferences` collection, and a re-solve runs automatically after —
you never need to separately ask for a re-solve, and you cannot skip the compiler by
constructing a raw schedule yourself. If a request can't be expressed by any tool
below, say so to the student rather than approximating it with the closest one.

## 2. The rule that matters more than anything else here

**Every numeric "how much do I care about this" parameter below is a bounded
`strength` enum (`gentle` / `moderate` / `firm`), never a raw number you choose.**
This is not a style preference — it's a hard lesson from building this system, and
it's worth knowing why, because it explains every other design choice in this doc.

The solver's objective has three tiers, strictly ordered by scale so a lower tier can
never outrank a higher one:

1. **Schedule as much as possible** — worth 10,000,000 points per session placed.
   This always wins. Nothing below should ever be able to threaten it.
2. **Satisfy preferences** — the tools in this document. Each is worth a few points
   to a few thousand, depending on `strength`.
3. **A tiny tie-break** for genuine ties. Worth ~1-14 points, never meant to drive
   behavior on its own.

That ordering was violated twice during development, both times because a numeric
weight — chosen by a human with the full source code in front of them — turned out to
be large enough that tier 2 started overriding tier 1. Concretely: a preference term
scaled by a session's exact time slot (a number that can run into the hundreds or
thousands) multiplied by even a modest-looking weight produced a value bigger than
10,000,000, and the solver responded exactly as told — it started leaving unrelated
sessions completely unscheduled just to satisfy that one preference a little better.
Both times this looked like a normal, sensible weight choice right up until it wasn't.

**The fix that makes this safe by construction**, and the reason every tool below
takes `strength` instead of a number: the actual internal weights are pre-chosen,
tested values that stay reliably inside tier 2 no matter what. You are never in a
position to pick a number large enough to cause this — the enum physically cannot
select one. If you ever find yourself wanting a "stronger than firm" option, don't
invent one; that instinct is exactly the failure mode above.

## 3. How a preference persists across a conversation

Every preference type is either:

- **Singleton** — there is only ever one active entry. Calling the tool again
  *replaces* it outright. (`set_preferred_work_hours`, `set_break_habits`.)
- **Accumulating** — multiple entries can be active at once, distinguished by a
  *scope* (which days, which time window). Calling the tool again with a **different**
  scope adds a new, additional entry; calling it again with the **same** scope
  replaces that one entry. (`set_daily_workload_limit`, `protect_time_block`.)

`remove_preference` deletes a specific entry outright. For a singleton type there's
never any ambiguity about which one. For an accumulating type with more than one
active entry, pass enough of the original parameters back (in `match`) to identify
which one — if that's still ambiguous, the call fails with the list of current
candidates rather than guessing (see §6).

Use `list_current_preferences` whenever you're not certain what's already active —
before a `remove_preference` call, or when the student asks what's currently shaping
their schedule.

## 4. Tools

Every tool in this section is implemented and tested against real data. §8 covers
what's designed but not wired up yet — don't call those; they exist in the catalog
below intentionally and only these six do.

### `set_preferred_work_hours`
**Singleton.** Sets the one daily window flexible work is rewarded for landing in.

Call it for a general daily-rhythm statement: *"I like working in the evenings,"*
*"mornings are my best time,"* *"I don't want to study before noon."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `start_time` | `"HH:MM"`, 24-hour | yes | e.g. `"17:00"` |
| `end_time` | `"HH:MM"`, 24-hour | yes | must be later than `start_time` |
| `strength` | `gentle`\|`moderate`\|`firm` | no, default `moderate` | `moderate` is the tested default |

**Example** — *"Honestly I do my best thinking after dinner, before that I'm useless"*
→ `set_preferred_work_hours(start_time="18:30", end_time="23:00")`
→ effect: sessions starting in that window are now worth more to the solver; nothing
outside it is forbidden, just less preferred when a choice exists.

### `set_daily_workload_limit`
**Accumulating**, scope = the `days` set (or "every day" if `days` is omitted).

Call it when the student talks about feeling overloaded on specific days, wanting a
lighter day, or wanting a genuine rest day: *"Sundays should be light,"* *"don't pack
more than a few hours into one day,"* *"I'm burning out."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `minutes_per_day` | integer, 30-900 | yes | 240 (4h) is a sane general default; 60-120 for an explicit rest day |
| `days` | array of weekday strings | no | omit for "every day"; don't pass all seven explicitly |
| `strength` | `gentle`\|`moderate`\|`firm` | no, default `moderate` | `firm` is right for an explicit rest day |

**Example** — *"Sundays need to actually be a day off"*
→ `set_daily_workload_limit(minutes_per_day=90, days=["Sun"], strength="firm")`
→ this **adds to**, doesn't replace, a general cap already set for every day — both
stay active, Sunday just gets its own, stricter number.

### `protect_time_block`
**Accumulating**, scope = the exact `days` + `start_time`/`end_time` combination.
**Hard** — total protection, no `strength` parameter, because there isn't a "softer"
version of this yet (see §8 if one ever needs to exist).

Call it for anything that must never have schoolwork scheduled over it: social plans,
sports, religious observance, family time. *"Don't touch my Friday nights,"* *"I have
church Sunday mornings,"* *"keep game night free."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `days` | array of weekday strings | yes, ≥1 | |
| `start_time` | `"HH:MM"`, 24-hour | yes | |
| `end_time` | `"HH:MM"`, 24-hour, or `"24:00"` | yes | use `"24:00"` for midnight, not `"00:00"` |

**Example** — *"Friday and Saturday nights are sacred, don't even think about it"*
→ `protect_time_block(days=["Fri","Sat"], start_time="19:00", end_time="24:00")`

### `set_break_habits`
**Singleton.** A *soft* goal — minimizes the single longest unbroken stretch of
flexible work, it does not forbid exceeding some fixed number. An absolute cutoff was
tried and rejected on purpose: it could only ever satisfy itself by dropping a session
outright when a genuinely urgent deadline needed a long push, which is worse than
occasionally allowing one.

Call it when the student talks about needing breaks or working too long without
stopping: *"I need a real break every couple hours,"* *"don't let me grind for four
hours straight."*

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `break_minutes` | integer, 15-120 | no, default 45 | how long a gap must be to count as a real break |
| `strength` | `gentle`\|`moderate`\|`firm` | no, default `moderate` | see warning below |

**`strength` here is not symmetric with the other tools — read this before choosing
`firm`.** Empirically: `gentle` barely moves anything (it loses every tradeoff against
finishing urgent work early). `moderate` is the tested, recommended default — it
noticeably shortens the worst stretch with *zero* cost to how early urgent work gets
finished. `firm` measurably starts trading against that — urgent work gets pushed
closer to its actual deadline instead of comfortably ahead of it. Only choose `firm`
if the student has explicitly said breaks matter more to them than finishing things
early.

**Example** — *"I need an actual break every couple hours, I don't care if it makes
stuff less optimal"*
→ `set_break_habits(break_minutes=45, strength="firm")` — the "I don't care" is what
licenses `firm` here; without it, default to `moderate`.

### `remove_preference`
Deletes one active preference. See §3 for the persistence model this depends on.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `preference_type` | one of `preferred_work_hours`, `daily_workload_limit`, `protected_time_block`, `break_habits` | yes | |
| `match` | object | only if >1 entry of that type is active | repeat enough of the original parameters to identify which one, e.g. `{"days": ["Fri","Sat"]}` |

**Example** — *"Actually never mind the Sunday thing, I'll manage"*, with both a
general daily cap and a Sunday-specific one active
→ `remove_preference(preference_type="daily_workload_limit", match={"days": ["Sun"]})`

### `list_current_preferences`
No parameters. Returns every active preference. Call before an ambiguous
`remove_preference`, or when asked "what have I told you so far."

## 5. What's always on, and why you don't control it

Four things shape every schedule regardless of anything above, and are deliberately
**not** exposed as tools:

- **Spreading out a big task's sessions** — doing all 8 chunks of a large assignment
  back-to-back on one day defeats the point of having split it up. Always on.
- **Urgency-aware prioritization** — a task's sessions get pulled earlier in
  proportion to real urgency (remaining work per hour until it's due), so a huge
  assignment due soon doesn't sit at parity with a small one due in two weeks. This is
  core scheduling behavior, not a personal style choice — it stays on.
- **A minimum buffer between any two sessions** (15 minutes, hard) — pure scheduling
  hygiene, not something anyone would want set to zero.
- **A short "review your notes" session generated after every lecture** — not tied to
  any assignment, just a standing study habit. (A way to turn this off per-student is
  designed but not built yet — see §8.)

If a student's request genuinely conflicts with one of these (e.g. "never prioritize
by urgency, just do things in the order I feel like"), say plainly that the system
doesn't support turning that off yet rather than trying to approximate it by misusing
one of the tools above.

## 6. Validation and error handling

- **Unknown tool, missing required parameter, or a value outside its declared
  range**: rejected before touching the schedule. You'll get a structured error
  describing exactly what was wrong — fix the call and retry in the same turn rather
  than telling the student something went wrong.
- **`remove_preference` with an ambiguous `match`** (or none, when multiple entries of
  that type exist): rejected with the list of current candidates for that type. Call
  `list_current_preferences` or ask the student, don't guess.
- **A `protect_time_block` call that would remove nearly all remaining working
  hours** (in combination with what's already protected): still accepted — it's the
  student's real request — but the response includes a warning you should relay to
  them, since the schedule may come back with far less placed than expected.
- **Nothing here ever silently no-ops.** If a call succeeds, something real changed
  and a re-solve has been triggered. If you don't get confirmation, don't tell the
  student it worked.

## 7. A full worked exchange

> **Student:** "I've got practice every weeknight so I can't work after 7pm on
> weekdays, but weekends are totally free."
> → `protect_time_block(days=["Mon","Tue","Wed","Thu","Fri"], start_time="19:00", end_time="24:00")`

> **Student:** "Also I'm way more productive at night when I do have time."
> → `set_preferred_work_hours(start_time="20:00", end_time="23:30")`
>
> *(Note the tension: the protected block above already blocks weeknight evenings —
> this preferred window mostly ends up applying to weekend nights, and that's fine;
> the two tools don't need to be reconciled by hand, the solver just optimizes against
> both as given.)*

> **Student:** "Sundays are for family, keep it completely clear."
> → `protect_time_block(days=["Sun"], start_time="00:00", end_time="24:00")` — a
> **second**, separate protected block; the weeknight one from turn 1 is untouched.

> **Student:** "Actually practice got cancelled for the season, I have my evenings
> back."
> → `remove_preference(preference_type="protected_time_block", match={"days": ["Mon","Tue","Wed","Thu","Fri"]})`
> — removes only that block; Sunday stays protected, the preferred-hours setting from
> turn 2 is untouched.

> **Student:** "What's actually set right now?"
> → `list_current_preferences()` → report back in plain language: preferred hours
> 8pm-11:30pm, Sundays fully protected. (The weeknight block is gone — it was removed
> last turn.)

## 8. Planned, not available yet — do not call these

Two things came up repeatedly in design discussion and map cleanly onto real user
requests, but nothing in the backend consumes them as a per-student parameter yet —
today they're fixed constants in `backend/optimizer/decompose.py`, the same for every
user. Calling a tool for either would silently do nothing, so none exists in the
catalog above. Noted here so whoever wires this next knows exactly what's missing:

- **Focus-session length** ("I like short 30-minute bursts" / "I do better in long
  2-hour blocks"). `decompose.py`'s `MAX_SESSION_MIN` (currently a flat 60, "never
  work on one subject for more than an hour") would need to become a per-user input
  to the task→session splitting step instead of a module constant.
- **Turning off the after-class review sessions** ("I take good notes already, I
  don't need a review block after every lecture"). `generate_review_sessions()`
  currently runs unconditionally for every course; it would need a per-student flag.

## 9. For whoever implements the wiring

| Tool | Internal `Preference.type` | Compiler | `strength` → weight |
|---|---|---|---|
| `set_preferred_work_hours` | `preferred_hours` | `_compile_preferred_hours` | gentle=10, moderate=20\*, firm=30 |
| `set_daily_workload_limit` | `daily_load_cap` | `_compile_daily_load_cap` | gentle=8, moderate=15\*, firm=25\* |
| `protect_time_block` | `avoid_block` | `_compile_avoid_block` | hard, no weight |
| `set_break_habits` | `max_continuous_work` | `_compile_max_continuous_work` | gentle=500, moderate=1000\*, firm=2000 |

\* = the exact value empirically tested this session (see `backend/optimizer/README.md`,
"Round 4" for `max_continuous_work`'s tuning history in particular — the others are
principled interpolations around one tested point, not independently verified across
the full range). All four compilers live in `backend/optimizer/preferences.py`; the
registry that dispatches on `type` is `REGISTRY` at the bottom of that file.

Weights above were tuned against a 14-day rolling window
(`backend/optimizer/run_prototype.py`'s default), not the 7-day horizon the frontend
currently assumes (`frontend/src/lib/preferenceCatalog.js`'s `HORIZON_DAYS`) — that
mismatch needs resolving before this goes live (see the chat history from this
session for the full list of frontend/backend drift found). The `-day`-based scaling
used throughout §2 means these specific weights should carry over safely to a shorter
window without re-tuning — day-based terms only get smaller as the window shrinks —
but that's an expectation, not something re-verified at 7 days yet.

`remove_preference` and `list_current_preferences` aren't preference *types* — they
need their own small API surface (find/delete by type+scope, list by student) rather
than a `compile_all()` entry; nothing for these exists in the Python layer yet.
