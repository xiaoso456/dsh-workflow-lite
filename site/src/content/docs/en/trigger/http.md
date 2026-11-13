---
title: HTTP triggers
description: Run the workflow when another program sends a POST request to an address.
sidebar:
  order: 4
---

An HTTP trigger gives each card an address and a token. When CI, a script or another tool sends a POST request to it, the workflow is triggered once, with the request body as background info. This feature is experimental.

![HTTP trigger: address, token and Copy curl command](../../../../assets/shots/en/trigger-http.webp)

## Use

1. Add a trigger card, click **Schedule ▾** in the header of **Trigger**, and choose **HTTP**.
2. Choose a workspace under **Run settings** and turn on the switch. The card shows **Receiving**.
3. Click **Edit** under **Trigger**; the dialog shows **Address** and **Token**. Click **Copy curl command** to get a command you can run as is.

The address defaults to the workflow name, such as `/trigger/nightly-report`; if another card already uses it, `-2` is appended. To change the address or token, click the pencil on that row and press Enter to save.

Calling it:

```sh
curl -X POST http://127.0.0.1:3791/trigger/<address> \
  -H "Authorization: Bearer <token>" \
  -d '{"pipeline":"nightly","status":"failed"}'
```

The request returns 202 as soon as it arrives, without waiting for the workflow to finish.

| Response | Meaning |
|---|---|
| 202 | Received and being handled. |
| 401 | Wrong token. |
| 404 | No such address, or the card is off. |
| 413 | The request body is over 1 MiB. |

## Settings

| Setting | Where | Default | Description |
|---|---|---|---|
| Address | **Trigger** dialog | Workflow name | Letters (any script), digits, `-` and `_`; must differ from other cards. The old address stops working once saved. |
| Token | **Trigger** dialog | Random | You can write your own: at least 16 characters, using letters, digits and `-` `_` `.` `~`. The old token stops working once saved. |
| New token | **Trigger** dialog | — | Replaces it with a new random token; the old one stops working right away and the address stays the same. |
| HTTP trigger listen address | Workflow hub **Settings** → **Triggers** | This machine only (127.0.0.1) | Pick **All interfaces (0.0.0.0)** or one interface address to let other machines call in; the address shown on the card then uses that interface. |
| HTTP trigger port | Workflow hub **Settings** → **Triggers** | 3791 | Shared by all HTTP trigger cards and only taken while one of them is on. Changing it changes the addresses. |

By default, requests within 5 seconds are merged into one trigger; see [Filters and conditions](/dsh-workflow-lite/en/trigger/filter/).

## Notes

- Only requests from this machine (127.0.0.1) are accepted by default. When other machines call in, requests are plain HTTP and anyone on the same network can see the token; use it only on a trusted network or behind an HTTPS proxy.
- When another program holds the port, or the chosen interface address is gone (after switching networks), the card shows **Error** and the reason; it recovers on its own once that is fixed or changed in Settings.
- The address and token are stored on this machine only and are not exported with the workflow. If the token leaks, click **New token**.
