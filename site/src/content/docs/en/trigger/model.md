---
title: Let the model build triggers
description: Tell the model in the conversation when a workflow should run, and it writes the script, tries it and sets up the trigger; ask it to troubleshoot when something goes wrong.
sidebar:
  order: 9
---

Triggers can be left to the model: say in the conversation when which workflow should run, and the model picks the trigger type, writes the script it needs, tries it, and adds a trigger to the workflow and enables it.

## Use

1. Describe what is wanted in the conversation, for example "run the workflow Log check whenever ERROR shows up in `logs/app.log`; write the script and make sure it works".
2. The model puts the script in `triggers/` in the workflow folder, tries it and looks at the output, then adds the trigger and fills in the trigger note and run settings.
3. Once the test passes, the model enables the trigger and says when it will fire, what command it runs and in which workspace. To check it before it is enabled, say "don't enable it yet" in the request.
4. If the workflow does not have **Record run state** turned on, or the graph itself still has problems, the model points that out or fixes it.

Disabling or re-enabling a trigger can also be asked for in the conversation.

The script lives in the workflow folder and the command points to it with `{workflow}`, so it keeps working after changing the workspace and travels with the workflow when exported.

## Troubleshooting

When a trigger shows **Error** or **Stopped automatically**, or does not fire when it should, ask the model to look into it, for example "the trigger of Log check stopped; find out why". The model can read every trigger's state, history, recent output and queue, fix the problem, try it again, and then enable it again.

## Settings

The guides the model reads on demand are controlled by **Guides for the model** in the [plugin settings](/dsh-workflow-lite/en/settings/plugin/), on by default. With it off, the model can still build triggers, but without the guidance on choosing a type, writing scripts and troubleshooting.

## Notes

- When the model enables a trigger that runs a command, it is the same as clicking **Confirm and enable** on the canvas; if the command, workspace or shell changes afterwards, it has to be confirmed again before it runs.
- When the plugin's data directory is outside the current workspace, writing a script into the workflow folder asks for approval.
- Commands run as DSH with no sandbox: it is worth reading the model's script and command; if in doubt, ask the model not to enable the trigger yet.
