# Voice assistants (Matter bridge)

The Kasbah server can act as a **Matter bridge** on the local network. The devices you pick show up in
**Google Home**, **Apple Home** or **Alexa** as ordinary Matter devices, and the assistant controls them
by voice. No skill, no cloud account and no public address are involved: the assistant talks to the
server over the local network.

The bridge is part of the server, not a plugin: it creates no device of its own, it republishes the
ones the plugins already provide.

> **Tested so far with a Matter test controller only** (matter.js), against a simulated house: pairing,
> states both ways, commands both ways, unpairing. Google Home, Apple Home and Alexa themselves have not
> been tried yet. The steps below follow each vendor's documentation; report what differs.

## What can be published

| Kasbah device | Shows up as | Notes |
|---|---|---|
| Light with on/off | Light | brightness too when the light has it |
| Cover (shutter, blind, gate, garage door) | Window covering (blind) | open, close, stop, position; a cover without a known position goes to the nearest end |
| Vehicle with a lock | Door lock | lock and unlock; assistants ask for a voice PIN to unlock |

Assistants do not support the Matter garage door type yet, so a **garage door shows up as a blind**:
"open the garage" works **without a voice PIN**, unlike a lock. Think about it before publishing one.

Publish **device by device**, and only what the assistants do not already know: a Hue light or a Somfy
shutter already linked to Google Home through the vendor's own integration would show up twice.

## Before you start

- The server and the assistant's hub (or phone) are on the **same local network**.
- The server accepts **UDP port 5540** (Matter) and **mDNS** (UDP 5353, multicast) from the local
  network. Matter runs over **IPv6**: leave it enabled on the server's network interface (a link-local
  address is enough).
- Wi-Fi settings that block multicast between clients (client isolation, some "IGMP snooping" setups)
  stop the assistant from finding the bridge.
- Open Kasbah **from the local network**: the bridge's card and its API refuse the public address,
  because the pairing code gives control over everything the bridge publishes.

## Turn the bridge on

1. **Settings → Voice assistants (Matter)**: turn on **Matter bridge**.
2. Open a plugin's group and tick the devices to publish (**Publish all** ticks a whole plugin). Changes
   apply at once, no restart.
3. While no assistant holds the bridge, the card shows a **QR code** and an **11-digit code**. Pair from
   the assistant's app (below). The card switches to **Paired** on its own.

The pairing keys stay in the server's state folder (`apps/server/.state/matter/`), not in the house
file. The device list lives in the house file (`matter` block, see [house-json.md](house-json.md)).

## Google Home

Google Home refuses an uncertified Matter device unless its test identifiers are declared in the
**Google Home Developer Console**, under the same Google account as your hub. It is free, and only
needed once.

**1. Declare the bridge** (on a computer)

1. Go to the [Google Home Developer Console](https://console.home.google.com/projects) with the Google
   account your Google Home uses.
2. **Create project**, give it a name, then **Create project**.
3. **Open** the project, then **Add Matter integration**. The first time: **Next: Develop**, then
   **Next: Setup**.
4. **Setup**: a **Product name** (for example "Kasbah Bridge") and a device type (the list may not offer a
   bridge; pick **Light**).
5. **Vendor ID**: the **test** option, then **0xFFF1** in the list. **Product ID**: **0x8000**.
6. **Save & continue**, then **Save**.
7. **Restart your Google hub** (unplug it a few seconds) so it reads the new integration.

**2. Pair** (in the Google Home app)

- A **Google hub** is required: Nest Hub (any), Nest Mini, Nest Audio, Google TV Streamer, Nest Wifi Pro…
  It must be in the same home as your account and on the same network as the server.
- In the app: **+** → **Set up device** → **New device** → choose your home → **Matter device**, then
  scan the QR code shown in Kasbah (or enter the 11-digit code when the app offers it).
- The bridge itself appears as an inert **bridge** device; the published devices appear as ordinary
  lights, blinds and locks, which you can move to rooms.

If it fails with "could not contact Google" or similar: check that the console integration says
**0xFFF1 / 0x8000**, that you are signed in with the **same account** as the hub, then restart the hub.

## Apple Home

1. iPhone or iPad with a recent iOS, on the same network. A **home hub** (HomePod, HomePod mini, Apple
   TV) is recommended for control away from home and for automations.
2. Home app → **+** → **Add Accessory** → scan the QR code in Kasbah (or **More options…** and enter the
   code).
3. Apple warns about an **Uncertified Accessory**: choose **Add Anyway**.
4. Pick a room for the bridge and for each published device.

## Alexa

Not tried yet, and the least certain of the three: Amazon's documentation asks for **certified** Matter
bridges, while users of similar uncertified bridges report that pairing often works but can be fickle.

1. An **Echo** that acts as a Matter controller (most recent Echo speakers and displays), on the same
   network.
2. Alexa app → **Devices** → **+** → **Add Device** → **Other** → **Matter**, then scan the QR code in
   Kasbah.
3. If the Echo does not find the bridge: same Wi-Fi network (2.4 GHz is reported to help), IPv6 enabled
   on the server, then try again; turning the bridge off and on in Kasbah restarts its announcement.

## A second assistant

The pairing code only works while **no** assistant holds the bridge. To add a second one (Apple Home
after Google Home, for example), share the bridge from the **first** assistant's app: open the bridge's
settings there and look for the option that links another app or turns on pairing mode. It gives a new,
temporary code to scan in the second app. The card then lists both assistants.

## Withdrawing

| To withdraw… | In Kasbah | In the assistant |
|---|---|---|
| a device | its switch in the card | it disappears |
| a whole plugin | **Withdraw all** on the plugin | all its devices disappear |
| everything, for now | the **Matter bridge** switch | devices become unreachable; pairing is kept |
| an assistant | **Unpair** next to it (press twice) | it loses every device and can no longer reach the bridge |

When the last assistant is unpaired, the card shows a new pairing code. If an assistant's app still
lists the bridge after unpairing, remove it there too.

Deleting `apps/server/.state/matter/` resets the bridge completely (new identity): every assistant
loses it. You should not need to: **Unpair** does the same, one assistant at a time.

## Troubleshooting

| Symptom | What to check |
|---|---|
| The card says the bridge **did not start** | the server log (`component: matter`): port 5540 already used by another Matter program on the machine, for instance |
| The card only says it is managed from the local network | you opened Kasbah through the public address: open it from the local network |
| The assistant does not find the bridge | same network, multicast not blocked by the Wi-Fi, IPv6 on the server, the card shows a code (no assistant holds it already) |
| A device is missing | it is ticked, its plugin is on, and its kind can be published (see the table above); the card lists ticked ids it cannot find |
| A device stays "unreachable" | the plugin lost the device (check its view in Kasbah) or the bridge is off |
