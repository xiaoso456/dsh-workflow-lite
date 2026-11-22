---
title: HTTP triggers
description: Run the workflow once each time another program sends a POST request to an address.
sidebar:
  order: 4
---

An HTTP trigger gives each trigger an address and a token. CI, scripts or other tools send a POST request to it to fire it once, with the request body as background info. This feature is experimental.

![HTTP trigger: address, token, Require a token, four call examples and Send a test request](../../../../assets/shots/en/trigger-http.webp)

## Use

1. Add a trigger, switch it to **HTTP** from the menu in the header of **Trigger**, and click **Edit**. The dialog generates an **Address** and a **Token**.
2. Choose a workspace under **Run settings** and turn on **Enabled**. The card shows **Receiving** and the address starts accepting requests.
3. **Examples** has curl, PowerShell, JavaScript and Python versions with the address and token filled in; copy one with the button at its top right.
4. Click **Send a test request** and click **Send** in the small card that opens. **Accepted; it fires as usual** means it worked; this is available only once the trigger is enabled.

The address defaults to the workflow name, such as `/trigger/daily-report`, with `-2` appended if another trigger already uses it. To change the address, click **Edit address**; to set a token yourself, click **Set your own token**; press Enter to save.

```sh
curl -X POST http://127.0.0.1:3791/trigger/<address> \
  -H "Authorization: Bearer <token>" \
  -d '{"pipeline":"nightly","status":"failed"}'
```

The token can also go at the end of the address: `?token=<token>`. The request is answered with 202 as soon as it arrives, without waiting for the workflow to finish.

| Response | Meaning |
|---|---|
| 202 | Received; processing starts. |
| 401 | Wrong token. |
| 404 | The address does not exist, or the trigger is not enabled. |
| 413 | The request body is larger than 1 MiB. |

## Settings

| Setting | Where | Default | Notes |
|---|---|---|---|
| Address | **Trigger** dialog | Workflow name | Letters, digits, Chinese characters, `-` and `_`; must differ from other triggers. The old address stops working once saved. |
| Token | **Trigger** dialog | Random | A token you set must be at least 16 characters of letters, digits, `-`, `_`, `.` and `~`. **New token** replaces it with a random one. The old token stops working once saved. |
| Require a token | **Trigger** dialog | Required | Choosing **None** asks for confirmation first; afterwards any program that can reach the address can fire it. The token is kept and is used again when switched back to **Required**. |
| HTTP trigger listen address | Workflow hub **Settings** → **Triggers** | This machine only (127.0.0.1) | With **All interfaces (0.0.0.0)** or an interface address, other machines can call in too. |
| HTTP trigger port | Workflow hub **Settings** → **Triggers** | 3791 | Shared by all HTTP triggers; taken only while one is enabled. Changing it changes the addresses. |

By default, requests within 5 seconds are merged into one trigger; see [Filters](/dsh-workflow-lite/en/trigger/filter/).

## Notes

- When other machines call in, requests travel as plain HTTP and anyone on the same network can see the token; use it only on a trusted network or behind an HTTPS proxy. Do not choose **None** for the token while the address is open to the network.
- When the port is taken by another program, or the chosen interface address is gone (after changing networks), the card shows **Error** with the reason; it recovers on its own once the port is free or another one is chosen in the settings.
