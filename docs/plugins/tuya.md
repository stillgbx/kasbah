# Tuya (CREATE light-fan)

| | |
|---|---|
| **Id** | `tuya` |
| **Devices** | a CREATE ceiling fan with light (WindCalm range): two Kasbah devices, a light (`light`) and a fan (`fan`) |
| **Connection** | **local**: Tuya local protocol 3.5 on the house network (TCP 6668); the Tuya cloud is only used once, to read the device key |
| **Account** | no account in Kasbah: the device's id, local key and address go in `.env` |
| **Views** | Lights (light and fan together), Home (device panels), Settings → Plugins |

## What the plugin does

- **Light**: turn on, turn off, and choose the color temperature from **three steps**: cool (4000 K), neutral (3300 K) and warm (2700 K). This model has no brightness control.
- **Fan**: on / off, speed from 1 to 6, direction (forward / reverse), timer (off, 1 h, 2 h, 4 h) and **silent beep** (turns off the device's acknowledgement beep).
- Settings made with the **RF remote** or in the vendor's app are picked up by Kasbah.
- The light and the fan are linked: the Lights view shows them together.

The plugin is written for this exact model (Tuya category `fsd`). Another Tuya device, even from the same brand, is not recognized as is: its data points (DPs) may differ.

## Connection

Once the local key has been retrieved, **nothing leaves the network any more**: the Kasbah server opens a direct connection to the fan and receives its state as it changes. There is no automatic discovery: Tuya's UDP broadcast is often filtered by routers and access points, so the IP address is given in `.env`. Set a **static DHCP lease** for the fan.

## Setup

1. Pair the fan in the mobile app (CREATE or Tuya Smart / Smart Life), on the same network as the server.
2. Retrieve the device's **id** and **local key**, only once: create a Smart Home project on `iot.tuya.com`, link the app's account to it, enable IoT Core, then run `npx @tuyapi/cli wizard`. The detailed procedure is in `tools/tuya-capture/README.md`.
3. In `apps/server/.env`, set `TUYA_DEVICES` (see below), then restart the server.
4. Tick **Tuya** in **Settings → Plugins**. As long as `TUYA_DEVICES` is empty, the plugin stays "Pairing required".
5. Place the light and the fan in the house like any other device.

**Do not pair the fan again** afterwards: that generates a new local key and breaks the link. The key contains special characters: do not pass it on the command line, nor in a message or a log.

## Configuration (`apps/server/.env`)

| Variable | Default | Purpose |
|---|---|---|
| `TUYA_DEVICES` | empty | JSON array, one object per physical device: `id`, `key` (local key), `ip`, `name`, and protocol `version` (`3.5` by default) |
| `TUYA_COMMAND_TIMEOUT_MS` | `8000` | Wait for a command to take effect, from 500 to 30,000 ms |
| `TUYA_RECONNECT_MS` | `700` | Reconnection interval, from 100 to 30,000 ms |

Example, with fictional values (the physical device's name is used to name the light and the fan):

```
TUYA_DEVICES=[{"id":"<device-id>","key":"<local-key>","ip":"192.168.1.50","name":"Living room fan"}]
```

## Limitations

- **Only one model is supported** (CREATE light-fan, protocol 3.5); adding another Tuya device requires writing its mapping.
- **Only three color temperatures**: the device ignores any intermediate value. No brightness variation.
- The server must reach the fan over TCP on port 6668. The Tuya app can show the fan online while Kasbah can't reach it: the app goes through the cloud. The plugin's health then gives the local connection error (unreachable host, refused connection, key changed).
- Setting the speed **turns on** the fan; turning it off resets the timer to zero.
- The local connection sometimes drops without warning: Kasbah reconnects by itself, and the state is picked up again on reconnection.
- The key is in `.env` in clear text: protect that file.

## Further reading

Internals, data points and protocol pitfalls: [wiki, Tuya](../../doc/3_plugins/3_18_tuya.md) (in French).
