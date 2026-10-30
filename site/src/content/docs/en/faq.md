---
title: FAQ
description: Common questions about installing, running and settings.
---

## I do not see the Workflows tab after installing

Make sure DeepSeek Harness is 0.2.x and restart it; for the web version, run `dsh web` again and refresh the page.

## The workflow is big and the model cannot read it

In **Workflow hub** → **Settings** → **Model**, raise the **Model read limit**; see [Plugin settings](/dsh-workflow-lite/en/settings/plugin/).

## I cannot see run progress on the canvas

Turn on **Record run state**; it takes effect from the next run. See [Workflow settings](/dsh-workflow-lite/en/settings/workflow/).

## My workflows disappeared after changing the data folder

Data is not migrated automatically. Change the **Data folder** back to the original path and restart DSH.

## The step limit is exceeded and the workflow cannot run

The default limit is 400 steps. Split the workflow, or raise **Max steps per workflow** in [Plugin settings](/dsh-workflow-lite/en/settings/plugin/).

## A changed plugin setting did not take effect

Settings marked **After restart** (**Data folder**, **Guides for the model**) need a DSH restart.

## The loop repeats forever and never ends

No conditional line leads out of the loop. Draw a line with a condition from a step in the loop to a step outside it as the exit; put a limit on the rounds in the prompt or a custom condition. See [Loops and parallel steps](/dsh-workflow-lite/en/editing/loops/).

## Lines with Pass or Fail do not go where expected

These two conditions need the upstream step to give a verdict at the end of its reply. The built-in **Review** step already does; for your own steps, say so in the prompt. See [Connections](/dsh-workflow-lite/en/editing/steps/#connections).

## A display card says "Too large to show on the canvas"

The file is over the display limit. Double-click the card to open the viewer, or open it with another program, or have the step produce a leaner version. See [Canvas display](/dsh-workflow-lite/en/display/overview/).

## Export says the current content has not been saved as a version

Export includes saved versions only. Save a version under **Versions** in the top bar first; see [Versions](/dsh-workflow-lite/en/manage/versions/).

## After merging into an existing workflow, my current content was replaced

Merging replaces the content with the version from the package and does not save the existing content automatically. Save a version before importing; see [Import, export and skills](/dsh-workflow-lite/en/manage/import-export/).
