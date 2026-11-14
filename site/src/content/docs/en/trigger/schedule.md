---
title: Scheduled triggers
description: Use a trigger card to run a workflow on a schedule instead of clicking Run each time.
sidebar:
  order: 1
---

A trigger card runs a workflow on a schedule: when the time comes, the plugin sends the workflow to a session and the model runs it as usual. This feature is experimental.

Besides schedules, a trigger card can [poll a command](/dsh-workflow-lite/en/trigger/poll/), run a [listener](/dsh-workflow-lite/en/trigger/listen/), receive [HTTP requests](/dsh-workflow-lite/en/trigger/http/), or run [after another workflow](/dsh-workflow-lite/en/trigger/after/) finishes. Session modes, safeguards, status and origin are shared by all of them and described on this page.

![A schedule trigger card on the canvas: icon, name and status, the chosen weekdays and time in the middle, Active and the next trigger time at the bottom](../../../../assets/shots/en/trigger-card.webp)

## Use

1. Drag **Trigger** from **Basics** in the step library, or right-click an empty spot on the canvas to add one. A trigger card takes no lines; it triggers the whole workflow.
2. New cards use **Schedule**. Under **Trigger** in the right panel, click **Edit**, set the rule, and click **Save**.
3. Choose the session mode and workspace under **Run settings**.
4. Turn on the switch at the top of the panel. The card shows **Waiting** next to its name and the next trigger time at the bottom.

To see it work right away, click **Trigger once now** in the panel, optionally add background info for that run in the small card that opens, and click **Trigger**.

![The settings panel of a trigger card: one summary row each for Trigger, Trigger condition, Trigger note and Safeguards](../../../../assets/shots/en/trigger-panel.webp)

**Trigger** is a card that looks like the one on the canvas: click the trigger type in its header (such as **Schedule ▾**) to pick another from the menu, which takes effect right away and can be undone; click **Edit** to change the details in a dialog. When the new type still needs something, **Edit** becomes **Write command** or **Pick workflow**. **Handling** (filters, trigger condition, trigger note) and the safeguards under **Run settings** each show one summary row; click a row to open a dialog and change it. Changes in a dialog take effect when you click **Save** (Ctrl+Enter); while there are unsaved changes, Esc or a click outside does not close it, so click **Cancel** instead. Once the card is selected, clicking its middle row also opens the **Trigger** dialog.

## Settings

| Setting | Values | Default | Description |
|---|---|---|---|
| Trigger | Every, Daily, Cron | Daily 09:00 | **Every** ranges from 1 minute to 7 days, counted from the moment the switch is turned on; **Daily** can be limited to certain weekdays; **Cron** takes a five-field expression in local time. |
| Trigger note | Text | Empty | Passed to the model as is on every trigger; a good place for the scope and requirements of the run. Shares a dialog with the [trigger condition](/dsh-workflow-lite/en/trigger/filter/#trigger-condition). |
| Session | New session, Continue last, Fixed session | New session | **Continue last** sends to the session used by the previous trigger, or creates one if it is gone. |
| Workspace | Workspaces opened before | None | New sessions are created here; with **Fixed session**, choose **Session** instead. |
| Allow overlapping runs | On, off | Off | When off, a trigger is skipped while the session from the previous trigger is still running. This and the next three settings are in the **Safeguards** dialog. |
| Run missed triggers | On, off | On | Scheduled triggers missed while DSH was not running fire once after startup. When off, they are skipped. |
| Hourly trigger limit | 1 or more, empty for no limit | 12 | Triggers beyond the limit within an hour are skipped. |
| Failures before auto-off | 1 or more, empty to never switch off | 3 | See **Status** below. |

## Status

**Active** at the bottom of a card means the plugin starts it on its own timer (schedule, poll); **Passive** means it waits for something outside to happen (listener, HTTP, after another workflow).

| Status | Meaning |
|---|---|
| Off | The switch is off. |
| Waiting | On; followed by the next trigger time. |
| Invalid settings | The rule or command is wrong; the panel says why. |
| Stopped automatically | Several failures in a row. Fix the cause, then switch it back on. |
| All paused | Paused on the [Triggers page of the workflow hub](/dsh-workflow-lite/en/trigger/manage/); the switch stays on. |
| Handled by another DSH | When several DSH instances share one data folder, only one handles triggers; this one takes over when it exits. |
| Can't trigger here | This environment cannot create sessions or send messages. |

A failure means the trigger itself did not get through: the workspace or session is missing, the session cannot be created, the workflow has errors and cannot run, or a poll command or listener cannot run. Skipped triggers, unmet conditions, filtered triggers and the outcome of a run after delivery do not count.

**Trigger history** in the panel lists the time and result of the last 20 triggers; click **All history** to see them all on the [**Triggers** page of the workflow hub](/dsh-workflow-lite/en/trigger/manage/). Click a record to see the details of that trigger; once the model starts the run, the arrow on the right of a record opens it. With a [trigger condition](/dsh-workflow-lite/en/trigger/filter/#trigger-condition), a trigger the model decided to skip shows **Not needed** and the reason.

## Questions before running

When the workflow has [user inputs](/dsh-workflow-lite/en/materials/inputs/), a trigger does not open the form. The model answers from the **Trigger note** and the background info, and only asks in the session when a required question cannot be answered.

## Origin

Every instance records how it was started. See **Origin** in the instance **Overview**: started from the canvas, started in the conversation, or triggered by a trigger card, along with the note and background info that came with the trigger. In the [workflow hub](/dsh-workflow-lite/en/manage/hub/), instances started by a trigger card show the card's name.

## Notes

- Triggers only fire while DSH is running; nothing runs after it is closed.
- The switch, workspace and session are stored on this machine only and are not [exported](/dsh-workflow-lite/en/manage/import-export/) with the workflow. After importing, choose them again and turn the switch on.
- The model can add trigger cards when asked in a conversation. Cards it adds are always off; review them and turn them on yourself.
- **Trigger once now** ignores the switch, the hourly limit and **Allow overlapping runs**.
- Do not open a workflow that has trigger cards with plugin version 0.10.0 or earlier; the trigger settings are lost on save.
