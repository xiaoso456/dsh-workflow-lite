---
title: After another workflow
description: Run this workflow whenever a run of another workflow finishes, chaining several workflows together.
sidebar:
  order: 5
---

An **After** trigger runs the workflow once a run of another workflow finishes. Use it to chain build, check and release, or to clean up after a failure. This feature is experimental.

![After trigger: the workflow to wait for and the result that triggers](../../../../assets/shots/en/trigger-after.webp)

## Use

1. Open the workflow to wait for and turn on **Record run state** in **Workflow settings**.
2. Add a trigger card to this workflow, click **Schedule ▾** in the header of **Trigger**, and choose **After**.
3. Click **Pick workflow**, choose the workflow to wait for under **Workflow** and the result that triggers under **Result**, then click **Save**.
4. Choose a session mode and workspace under **Run settings** and turn on the switch. The card shows **Waiting**.

When a run of that workflow finishes with a matching result, this workflow triggers once. The background info holds that run's instance ID, result, steps done, goal, workspace and the location of its run-state file, which the model reads when it needs that run's output.

## Settings

| Setting | Options | Default | Description |
|---|---|---|---|
| Workflow | Any workflow except this one | None | The workflow to wait for; it needs **Record run state** on. |
| Result | Succeeded, Failed, Any result | Succeeded | **Any result** includes cancelled runs. |

Whether a run has finished, and how, is read from the overall status in its run state: it counts as finished once it becomes **Done**, **Failed** or **Cancelled**. Changing the overall status by hand in the [workflow hub](/dsh-workflow-lite/en/manage/hub/#instances) counts too.

## Notes

- Only runs that finish after the switch is turned on count; earlier ones are not caught up. Each run triggers once.
- If the workflow being waited for is renamed, deleted, or has **Record run state** turned off, the card shows **Invalid settings**; pick it again or turn the setting back on.
- Two workflows waiting for each other trigger back and forth, capped by **Hourly trigger limit**.
- After triggers have no **Filters**; a **Trigger condition** still works.
- **Trigger once now** does not wait for the other workflow; the background info is only what you type.
