---
title: Reviewing each round's output
description: When a loop runs, view the version of every round's output and pick two rounds to compare.
sidebar:
  order: 9
---

When a loop runs repeatedly, a step that writes an output file saves a version after every round, which you can look back at or compare in pairs. This works only when running inside the plugin; nothing is saved after exporting as a skill.

![The viewer's Versions: pick any round to view](../../../../assets/shots/en/rounds-viewer.webp)

## Look back on a display card

On an instance's canvas, move the pointer over a display card with two or more saved versions (or select it): a ruler appears below the card, and the title row shows which version is on display.

![The ruler under a display card: on round 1, with the version name and save time below it](../../../../assets/shots/en/rounds-bar.webp)

| Action | Effect |
|---|---|
| Hover a version on the ruler, or drag across it | The card switches to that version and stays there after the pointer leaves |
| Click the version name in the title row | Lists every version; hover to preview, click to choose |
| Click the ✕ in the title row | Back to the latest; if a new version arrives meanwhile, a dot appears on the ✕ |
| Keyboard ← → Home End | Step between versions, jump to either end |

- One tick per version. The clock sits on the version on display, its ring filled to "this version / all versions", and rolls along the ruler when you switch.
- Below the ticks are the version's name and save time; reviewed versions carry a dot, one color for passed and one for failed.
- While an older version is on display, the name in the title row turns the accent color.
- Rounds are named like "Round 2 · after Review", and failed ones carry "(failed)".

## Compare

Click **Versions** in the viewer to view any round, or pick two rounds as "old" and "new" to compare.

![Pick two rounds to compare line by line; additions and deletions are easy to see](../../../../assets/shots/en/rounds-compare.webp)

| Mode | For | Description |
|---|---|---|
| Diff | Text | Marks added and removed lines, and folds the lines that did not change. |
| Side by side | Markdown, web pages, images | Compares the layout of the two versions next to each other. |
| Slider | Images | Drag the divider to compare. |

## Storage

- At most 20 versions are kept per output; beyond that the first version and the latest few are kept, with "N versions omitted in the middle".
- See the space used in **Workflow hub → Storage**, where you can **Clear** it; the current output files are untouched.
- Deleting an instance deletes its per-round versions too.
