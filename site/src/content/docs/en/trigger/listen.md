---
title: Listener
description: Let a long-running program watch logs, folders or messages and run the workflow for every line it prints.
sidebar:
  order: 3
---

A listener is a command that keeps running: it starts when the switch is turned on and stops when it is turned off. Every line it prints to standard output is one trigger, with that line as background info. It suits things that need constant watching, such as errors in a log, new files in a folder or messages on a queue. This feature is experimental.

![The confirmation card before a listener starts: the command and the workspace](../../../../assets/shots/en/trigger-confirm.webp)

## Use

1. Add a trigger card, click **Schedule ▾** in the header of **Trigger**, and choose **Listen**; click **Write command**, fill in **Command**, and click **Save**.
2. Choose a workspace under **Run settings**.
3. Turn on the switch, check the command and workspace in the confirmation card, and click **Confirm and turn on**.

The card shows **Receiving** and when the program started, and its middle row changes to the last line the program printed. Click **Edit** under **Trigger**; the right side of the dialog shows the program's recent output, including its error output.

When a log prints many lines at once, use [filters](/dsh-workflow-lite/en/trigger/filter/) to merge them, drop duplicates or keep only lines with certain words. By default, lines within 5 seconds are merged into one trigger.

## Writing the program

- Print one line per event; when an event has several lines of content, print it as one line of JSON.
- Flush after each line, for example `print(..., flush=True)` in Python, or `--line-buffered` for `grep` in a pipe.
- Write debug messages to error output, not standard output.
- Keep running and do not move itself to the background (no `&`, `nohup` or `start`).
- Prefer Node for scripts so they run on every system; write the command as `node "{workflow}/triggers/xxx.mjs"`, where `{workflow}` becomes the workflow folder.

The model can write the script for you. How commands run and are confirmed is the same as for [polls](/dsh-workflow-lite/en/trigger/poll/#running-commands).

## Status

| Status | Meaning |
|---|---|
| Receiving | The program is running. |
| Restarting | The program exited unexpectedly; followed by the next restart time. The wait starts at 2 seconds and doubles each time, up to 1 minute. |
| Needs confirmation | The command or workspace changed; click **Confirm command** in the panel to continue. |

A program that exits within 1 minute of starting counts as a failure (a bug in the script, a missing command, missing dependencies); after **Stop after failures in a row** failures the card stops automatically. Once it has run for a full minute, the failure count resets.

## Notes

- Turning off the switch or closing DSH ends the program along with the child processes it started.
- Triggers beyond **Max triggers per hour** are dropped, and the history records only one **Skipped** every 10 minutes.
