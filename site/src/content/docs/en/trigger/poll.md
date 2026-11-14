---
title: Poll
description: Run a command at an interval and run the workflow when it succeeds or its output changes.
sidebar:
  order: 2
---

A poll trigger runs a command on this machine at an interval and decides from the result whether to trigger. It suits things you have to check to know, such as new commits on a remote, a changed web page or a file that appeared. This feature is experimental.

![Poll settings: interval, fire condition, workspace and command](../../../../assets/shots/en/trigger-poll.webp)

## Use

1. Add a trigger card, click **Schedule ▾** in the header of **Trigger**, and choose **Poll**.
2. Click **Write command**, pick an **Interval** (click **Custom…** for any other value), choose **Fire when**, and choose the **Workspace** the command runs in.
3. Fill in **Command**, or click **Start from a template**, search, pick one and edit it; click **Save**.
4. Turn on the switch, check the command and workspace in the confirmation card, and click **Confirm and turn on**.

The example next to **Fire when** shows which of six checks in a row would fire, and changes with the choice. **Workspace** is the same setting as under **Run settings**, where new sessions open too; after changing it and saving, confirm the command again.

The card shows **Checking** and the result of the last check, and the bar in its middle row runs to the next check. Click **Edit** under **Trigger**; the command's recent output is shown below the command box.

## Try it

Before saving, you can run the command once: click **Try it** at the top right of the command box and confirm in the small card that pops up. The command runs in the chosen workspace (or the current session's workspace if none is chosen). The result bar shows the exit code, whether it counts as success under **Run succeeds**, and how long it took, with the output below. Trying it does not switch the card on or trigger the workflow; once you edit the command, the last result is put away.

![The result of Try it: exit 0, counts as success, the time taken, and the command's output below](../../../../assets/shots/en/trigger-try.webp)

## Settings

| Setting | Values | Default | Description |
|---|---|---|---|
| Command | One command | Empty | Runs in the system shell (cmd on Windows, sh elsewhere). It may use the variable `{workflow}`, replaced with this workflow's folder before running; with a script there, write `node "{workflow}/triggers/check.mjs"`. |
| Interval | 1 min, 5 min, 15 min, 1 h, 1 d; **Custom…** takes 10 seconds to 7 days | 5 minutes | How long to wait after each run; it runs once right away when switched on. |
| Fire when | Run succeeds, Output changes | Run succeeds | See the table below. |
| Workspace | Folders of the sessions in the sidebar | None | Where the command runs; without one, Try it uses the current session's workspace, and one must be chosen before switching on. |

| Fire when | Triggers | Background info |
|---|---|---|
| Run succeeds | Exit code 0 means success. Fires once when it goes from failing to succeeding; staying successful does not fire again. | The command's standard output |
| Output changes | Fires when the standard output differs from the previous check. The first check only records the output and does not fire; checks with a non-zero exit code are not compared. | The new standard output |

For filters and trigger conditions see [Filters and conditions](/dsh-workflow-lite/en/trigger/filter/); for session modes and safeguards see [Scheduled triggers](/dsh-workflow-lite/en/trigger/schedule/).

## Running commands

- The command runs as DSH in the chosen workspace, just like running it in a terminal yourself, without a sandbox. You confirm the command before switching it on; after the command or workspace changes, the card shows **Needs confirmation** and stops until you click **Confirm command** in the panel.
- The command should finish quickly and not wait for input. Running longer than the interval (5 minutes at most) is a timeout.
- A missing command, a failure to start or a timeout counts as a failure; after **Failures before auto-off** failures the card stops automatically. A non-zero exit code is not a failure.
- The model can write the script for you: describe in a conversation when the workflow should run. The model puts the script in the workflow folder, tries it, and adds a trigger card that is off; review it, choose a workspace and turn it on.

## Notes

- After DSH restarts, the check continues from the last result, so a restart does not cause an extra trigger.
- **Output changes** compares the whole output. If the output contains something that changes every time, such as a timestamp, every check triggers; have the script print only the part that matters.
