---
title: Filters and conditions
description: Merge, deduplicate or drop triggers by keyword, or let the model decide first whether a trigger needs a run.
sidebar:
  order: 5
---

Poll, listener and HTTP triggers all bring background info. **Filters** drop unwanted triggers inside the plugin at no model cost; a **Trigger condition** lets the model read the content and decide.

![Filters and trigger condition](../../../../assets/shots/en/trigger-filter.webp)

## Filters

| Setting | Default | Description |
|---|---|---|
| Merge triggers within seconds | 5 seconds for listeners and HTTP, 0 for polls | Counted from the first arrival; everything within that time becomes one trigger, with the background info in arrival order. |
| Same content only once within minutes | 0 | Identical content counts only the first time within that time. |
| Only when it contains | Empty | Triggers only when the content contains any of the words; not case-sensitive. |
| Not when it contains | Empty | Does not trigger when the content contains any of the words; takes priority over the previous setting. |

Separate words with commas or new lines; 0 or empty turns a setting off. Filtered triggers are not recorded in the history.

## Trigger condition

Put anything that needs reading the content to decide into **Trigger condition**, for example "Only handle errors from the payment module". With it, the model decides first on every trigger:

- A run is needed: the workflow starts as usual.
- No run is needed: the model gives the reason and stops, and the history shows **Not needed** and the reason for that trigger.

Deciding takes one model call. Use filters for anything keywords can catch; if deciding needs reading files or looking things up, make it the first step of the workflow and use a conditional line that goes straight to the end.

## Notes

- When the background info is long, the message to the model holds only the beginning; the full text is saved to a file the model reads when needed.
- **Trigger once now** skips the filters; the trigger condition is still decided by the model.
