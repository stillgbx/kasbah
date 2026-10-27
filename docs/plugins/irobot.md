# iRobot (Roomba)

| | |
|---|---|
| **Id** | `irobot` |
| **Devices** | vacuums (`vacuum`), one per robot on the account |
| **Connection** | **local**: the robot hosts its own MQTT broker (TLS) on the house network; the cloud is contacted only once, to obtain the password for that broker |
| **Account** | iRobot account e-mail and password, entered once in Settings; only each robot's local password is kept |
| **Views** | Robots, Home (room panel, robot dock), Settings → Plugins |

![Robots view](../screenshots/robots.webp)

*Screenshot of the demo (simulation, no real device).*

## What the plugin does

- **Robot state**: activity (docked, cleaning, paused, returning to dock, error), battery, full bin, error message, updated live (the robot pushes its state by itself, no polling).
- **Commands**: **Start** (or resume a paused mission), **Pause**, **Return to dock**, **Locate**.
- **Mop** (robots that wash, such as the Roomba Combo): pad attached or not, water level.
- **Robot found automatically** on the network: no IP address to enter, and an address change (DHCP) is picked up on the next scan.
- A robot on the account that cannot be found on the network (switched off, off Wi-Fi) stays displayed, marked **Off network**.

## Connection

Once the account is linked, everything happens locally: the Kasbah server opens an encrypted MQTT session (port 8883) directly with the robot. No vendor polling, no quota, nothing leaves the network.

The detour through the iRobot account is needed only once: recent Roombas no longer hand out the password of their local broker to whoever asks for it on the network. So Kasbah obtains it by signing in to the account, then stores it, for each robot, in `apps/server/.state/irobot-session.json`. The **account** password passes through the server only once and is neither written nor logged. On the local network it crosses in plain HTTP, since Kasbah is not served over HTTPS. To keep it off the network, link the account from the public address (HTTPS) when Kasbah has one (`MCP_PUBLIC_URL`, see the README's **Remote access**). There is no delegated sign-in (OAuth). Accounts with two-factor authentication are not supported.

## Setup

1. Tick **Irobot** in **Settings → Plugins**, with the robot switched on and on the same network as the server.
2. In the iRobot section of Settings → Plugins: enter the **iRobot e-mail** and the **password**, then **Link the account**.
3. The robot appears in the card's list, and in the Robots view. Nothing to copy into `.env`.
4. **Unlink the account** closes the links and erases the local passwords.

## Configuration (`apps/server/.env`)

Everything is optional and no secret goes in there.

| Variable | Default | Purpose |
|---|---|---|
| `IROBOT_SESSION_FILE` | `apps/server/.state/irobot-session.json` | Where to keep the robots' local passwords. Empty: the link is lost on every restart |
| `IROBOT_COUNTRY` | `FR` | Account country code (two letters) |
| `IROBOT_SCAN_MS` | `120000` | Pace of the network scan that finds a robot (15,000 to 3,600,000 ms) |
| `IROBOT_SCAN_TIMEOUT_MS` | `4000` | How long a scan listens |
| `IROBOT_HOST` | *(none)* | Robot address, probed directly on top of the broadcast. Only for a robot on another network than the server (IoT network, VLAN); give it a DHCP reservation |
| `IROBOT_DISCOVERY_URL`, `IROBOT_APP_ID`, `IROBOT_USER_AGENT` | vendor values | Change only if iRobot moves its API |

## Limitations

- The robot **does not report its position** and does not provide its map locally: nothing to place in the 3D view beyond its dock. No choice of rooms to clean, no wear counters for consumables.
- **Only one local session at a time**: while Kasbah holds the link with the robot, another application that wants to talk to it locally on the same network may be refused. The iRobot app normally goes through the cloud and is not affected (case not verified with the app itself).
- **Return to dock while cleaning**: Kasbah sends a pause then, a few seconds later, the return to dock (otherwise the robot ignores the command). So it takes about 3 to 7 seconds before it moves.
- The robot is found by UDP broadcast (port 5678) on the server's network. On a separate network (IoT network, VLAN), set `IROBOT_HOST`, and let the server reach the robot on UDP 5678 and TCP 8883. A guest network that isolates its clients stays out of reach.
- Unknown error codes are displayed as "Error N".
- Tested with a single robot (a Roomba Combo); several robots are planned but untested.

## Further reading

Internals, protocol pitfalls and measurements: [wiki, iRobot Roomba](../../doc/3_plugins/3_14_irobot-roomba.md) (in French).
