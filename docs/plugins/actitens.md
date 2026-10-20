# TENS actiTENS mini

| | |
|---|---|
| **Id** | `tens` (a **local** plugin, not a server plugin) |
| **Devices** | actiTENS mini electrostimulator (Bluetooth name `acTENSv2_…`) |
| **Connection** | **local to the computer**: Bluetooth Low Energy, directly between the browser and the device (Web Bluetooth); the Kasbah server is not involved |
| **Account** | none |
| **Views** | TENS, Settings → On this device |

> This device sends current through the body. Kasbah reproduces the settings of the original app but does not replace it: refer to the actiTENS mini manual for safety precautions. The protocol was worked out by observing the official app, without any vendor documentation.

## What the plugin does

It drives the TENS from Kasbah, without the phone app:

- **Start, pause, resume, stop**, session duration, battery (with "Charging" while on the cable).
- **Programs P1 to P12**: Gate Control 100 Hz / 80 Hz, Endorphin, Mixed, Sequential, HAN stimulation, Burst 2 Hz, Frequency modulation, Muscle relaxation, Massage, Friction, Sensitive areas.
- **Intensity per channel** (channels 1 and 2): slider or +/− buttons, in 0.5 mA steps, **capped at 30 mA per channel**. The TENS copes poorly with commands sent too close together: Kasbah ramps the intensity up itself, at a steady pace.
- **Target intensities**: one slider per channel under "Channels"; after the start, the session ramps up to these values on its own (0 = manual adjustment).
- **Favorites**: a program's star saves the complete launch (program, duration, channels, target intensities). You can have several per program; they relaunch in one click. They are remembered per computer.
- **Electrode check** at start: "Electrodes not detected" until the TENS is placed on the skin.

## Why a local plugin

This is deliberate: **the TENS exists only on the computer that enabled it.** A server plugin broadcasts its devices to every screen; this one never does. The other screens in the house (the landing tablet, for example) see nothing of it, and **neither automations, nor scenes, nor the assistant (MCP) can reach it**, by construction. It therefore has no `.env` section and does not appear in Settings → Plugins.

## Required browser

- **Chrome or Edge**: Firefox and Safari do not offer Web Bluetooth. Without Bluetooth, the TENS page and Settings say so ("Bluetooth unavailable in this browser").
- Kasbah must be opened on **`localhost` or over HTTPS**: Web Bluetooth is refused on a local-network `http://` address. The simplest way is to open Kasbah on `localhost` on the computer that has Bluetooth.
- The computer must be **within range** of the TENS (a few meters) and have Bluetooth.

## Setup

1. Open Kasbah in Chrome or Edge, on the chosen computer, then **Settings → On this device** and enable **TENS actiTENS mini**. The **TENS** entry appears in the menu, on this browser only.
2. **Close the actiTENS phone app**: the TENS accepts only one connection at a time, and keeps only one pairing (the phone will have to be paired again to use the app).
3. **First connection**, in this order:
   - turn the TENS on (green light), then **hold the center button for 3 seconds**: the light blinks **blue**, it accepts a new device;
   - pair it from **Windows** (Settings → Bluetooth & devices → Add device → Bluetooth → `acTENSv2_…`): this is how Windows learns its name;
   - in the **TENS** view, **Connect**: the list then offers only `acTENSv2_…`. Without going through Windows: **Other devices**, then the "Unknown device" whose address starts with `00:30:3A`.
4. Place the TENS, choose a program and a duration, adjust the channels, **Start**.

**Automatic reconnection (optional)**: for Kasbah to reconnect without a click, even after a page reload, enable in Chrome `chrome://flags` → "Web Bluetooth new permissions backend" → *Enabled* (`edge://flags` in Edge), then restart the browser. Without this setting, reloading the page cuts the link and you have to click Connect again. **The session itself keeps running on the TENS** and its state is read back on reconnection.

## Where it is stored

In the browser of the computer (`localStorage`), never on the server or in the house file: the plugin's activation, the favorites, the identifier of the paired device and the last launch. Clearing the site data erases these settings.

## Limitations

- **One computer at a time**, one TENS: no access from the other screens, no automation.
- The TENS refuses a program started when it is not placed on the skin ("Electrodes not detected").
- After a disconnection, the session keeps running on the device; if it was started from another computer, Kasbah shows "Started from another device" instead of the program name.
- A blinking pink light (internal error; according to the manual, switch off for 15 minutes) was seen once with no known cause.

## Further reading

Bluetooth protocol, programs, intensity queue and pitfalls: [wiki, TENS actiTENS mini](../../doc/3_plugins/3_21_actitens-tens.md) (in French).
