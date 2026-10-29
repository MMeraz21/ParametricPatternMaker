# Workflow

How we work on this project with Claude Code and the installed skills.

## Who runs what

| You | Claude |
|---|---|
| `npm run dev` in your own terminal. Hot reload picks up edits. | `npm test`, `npm run typecheck`, `npm run build` |
| Look at the window and judge whether pieces look right. | Writing code and tests, git, PRs, CI |
| Review PR diffs on GitHub. | Fixing until tests and typecheck pass. |

Claude can't reliably see the Electron window, so visual checks are yours until the
verification skill exists (see Setup).

## How skills get used

- Four skills load automatically when relevant: `typescript-best-practices`, `deslop`,
  `find-skills`, `setup-pstack`, plus built-ins (`/code-review`, `/simplify`, `/init`, `/run`).
- The other 54 are user-only. Start them with `/<name>`, or say "use the X skill".
- Principles (`principle-*`) load when another skill references them, or when you name them.

## Setup (once)

1. **`/init`**: create `CLAUDE.md` with project rules (core stays pure, units in mm,
   `env -u ELECTRON_RUN_AS_NODE` when Claude launches the app) and which principles apply to
   `src/core`.
2. **`/create-verification-skill`**: after milestone 3, once the canvas exists. Gives Claude a
   way to drive the app and check that pieces render correctly.

## Per milestone

| Step | Skill | Notes |
|---|---|---|
| 1. Clarify | `/sharpen` (optional) | Only for vague asks. Skip for milestones PLAN.md already spells out. |
| 2. Design | `/architect` | Types and module shape before code. Matters most for geometry, seam allowance, PDF tiling. |
| 3. Build | `/tdd` | Core gets tests first. Geometry has exact, cheap checks. |
| 4. Impact | `/blast-radius` | When changing the data model or `evaluate()`. Skip for leaf code. |
| 5. Review | `/code-review` always; `/interrogate` for hard parts | Hard parts: bezier offsetting, true-scale PDF, undo/redo with the DAG. |
| 6. Clean up | `/simplify` or `/deslop` | Quick quality pass before committing. |
| 7. Ship | Branch, then PR | CI runs; you review the diff. |

Example:

```
/architect milestone 2
(review the sketch)
/tdd implement it
/code-review
open a PR
```

## When things go wrong

- **A bug in grading or geometry**: describe the symptom and ask for the root cause
  (`principle-fix-root-causes`). After two failed fixes, `principle-attack-the-premise`.
- **The same mistake keeps happening**: `/correct`. It turns the lesson into a type, test or lint
  instead of another instruction.

## Understanding the code

- `/how`: how something works, or where new code should live.
- `/why`: why something is built the way it is.
- `/teach`: a full plain-language explanation before building on a part.
- `/ketchup`: catch up after Claude has been working for a while.
- `/bro`: restate the last message without jargon.

## Occasionally

- `/reflect`: end of a long session; turns lessons into skill edits.
- `/arena`: for open-ended design choices (e.g. the fabric layout packing algorithm).
  Runs competing attempts and keeps the best parts. Costs more.
- `/swarm`: for wide parallel checks (e.g. every size × every piece against seam-length rules).

## Skip for now

`benchmark-checklist`, `make-bot-ui`, `automate-me`, `maintain-verification-skill` (until the
verification skill exists), `figure-it-out` (PLAN.md already covers it).
