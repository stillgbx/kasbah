# Android Auto app

An Android app (`apps/android`) that puts Kasbah on the car's screen through **Android Auto**. It runs on
the phone; Android Auto shows it in the car. It uses the routes the web app already uses: nothing to
change on the server.

| On the car's screen | |
|---|---|
| ![Gates and garage doors, one of them open](screenshots/android-auto-car.webp) | ![A garage door's action screen](screenshots/android-auto-car-action.webp) |

| On the phone | |
|---|---|
| <img src="screenshots/android-auto-phone-signin.webp" alt="Sign-in" width="270"> | <img src="screenshots/android-auto-phone-connected.webp" alt="Signed in" width="270"> |

Screenshots of the demo property in Google's Android Auto simulator (simulated devices only); the
Android Auto parts around the app (map, app bar) are cut out.

## What it does

- **Gates and garage doors**: one tile per cover whose class is `gate` or `garage`, with its state
  (closed, open, opening…, offline, or unknown for a one-way radio motor). Tapping a tile never moves
  anything: it opens a screen with **Open**, **Close** and **Stop**. Tiles carry short names that fit the
  car's screen: the kind, numbered when the house has several (*Gate*, *Garage 1*, *Garage 2*), with the
  number drawn on the icon too.
- **Approach alert**: when the car comes within 400 m of the house, without opening the app, a
  notification shows over the map with the doors' states and an **Open** button for two of them (Android
  Auto's limit). Tapping the notification itself opens the app's tiles for the others. It only shows when
  the phone is projected by Android Auto, and is removed once the car leaves the circle. The house's
  position is its `origin`, read from the server and kept on the phone.
- **Talk**: the microphone button listens to one sentence through the car's microphone, sends it to the
  transcription, then to the assistant ("Ask Kasbah"), and says the answer aloud with the Kasbah voice
  (the account's voice, when *spoken answers* is on in the transcription plugin), or with Android's own
  voice otherwise. The end of the sentence is detected as in the web app (one second of silence).
- **Car**: a probe of what Android Auto reports about the car (model, energy and connector types,
  battery and range, speed, odometer). Raw values, also written to the phone's log
  (`adb logcat -s KasbahProbe`). Android Auto does not report tire pressure.
- **Phone screen**: the server address and the sign-in, styled like the server's sign-in page. The
  password is sent once and never stored; only the session cookie is. Once signed in, **Doors in the
  car** lists the gates and garage doors: ▲ ▼ set their order, which also numbers them, and ★ picks the
  two with a button in the approach alert (none picked: the first two). These choices belong to the
  phone, not to the car.

The app needs the server's **public address** (see [Remote access](../README.md#remote-access)) when the
phone is away from home. On the local network, it works without an account.

## Building and installing

Requirements: Android Studio (it brings the JDK and the SDK manager), the SDK platform-tools, and the
*Android Auto Desktop Head Unit Emulator* (SDK Tools tab). Gradle downloads the Android platform it
needs (API 36).

### For the simulator

```bash
cd apps/android
export JAVA_HOME="<Android Studio>/jbr" ANDROID_HOME="<Android SDK>"
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

An app installed this way shows in the **simulator** only. The debug build is `org.kasbah.auto.debug`: it
installs next to the one from Google Play, without replacing it.

### For the car

**A real car only shows car apps installed from Google Play.** Android Auto's *Unknown sources*
developer option covers media and messaging apps, not apps built with the Car App Library like this one
([Google's testing guide](https://developer.android.com/training/cars/testing)). The simulator skips the
check, so everything can look fine on a computer and the app still be missing in the car. The way in,
without review or public listing, is Play's **internal testing** track:

1. **A Google Play developer account** (one-time fee). Its public profile shows an e-mail address: use
   a dedicated one.
2. **The app in the Play Console**, with package name `org.kasbah.auto` (it cannot change afterwards).
   Play's *Internal app sharing* would be quicker, but it refuses an app that was never published on any
   track: start with internal testing.
3. **An upload key**, created once and kept **outside the repository**:
   ```bash
   keytool -genkeypair -v -keystore <outside the repo>/kasbah-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
   ```
   then copy `apps/android/keystore.properties.example` to `apps/android/keystore.properties` (ignored by
   git) and fill in the keystore's path, with `/`, and its password. Google Play signs the app for users
   with its own key; this one only identifies your uploads.
4. **The signed App Bundle**: `./gradlew bundleRelease` writes
   `app/build/outputs/bundle/release/app-release.aab`.
5. **In the Play Console**, *Test and release → Testing → Internal testing*: create an e-mail list of
   testers with the phone's Google account, then *Create release*, let Google generate the app signing
   key, upload the `.aab`, and *Save and publish* (it only reaches the testers). The warning about a
   missing deobfuscation file can be ignored.
6. **On the phone**: open the testers' join link (*Testers* tab, opened in a browser with the phone's
   account), accept, **uninstall a version installed by `adb`** (Play will not replace an app signed
   with another key), then install from the Play Store page the link leads to. The first release can
   take a few minutes to show.

For each new version, raise `versionCode` in `app/build.gradle.kts`, build the bundle again and create a
new internal testing release: the phone updates from Play.

### First start

On the phone, open **Kasbah Auto** (the logo with a car badge, to tell it from the installed web app),
enter the server address, the user and the password, and allow the microphone, the notifications and the
location, then the location **all the time** (Android shows it as a settings page): the approach alert
needs it. Android refuses the alert's geofence when *Google Location Accuracy* is off in the phone's
location settings. In Android Auto the app
shows as **Kasbah**, without the badge. The app follows the phone's language: English, or French on a
phone set to French.

## Tests

```bash
cd apps/android
./gradlew testDebugUnitTest
```

They run on the computer, without phone or car (about a minute), and are not part of `npm test`, since
not every machine has Java and the Android SDK:

- **logic**: the end of a sentence (the web app's own cases), the WAV sent to the transcription, what is
  read from the server (session cookie, gates and garage doors, the assistant's answer), plug names;
- **car screens**: built on a simulated Android ([Robolectric](https://robolectric.org/)) with Google's
  car testing library, which checks each screen against Android Auto's rules while building it. A
  screen the car would refuse fails here instead of showing "not responding" in the car.

## Trying it on a computer

`apps/android/dhu.cmd` (Windows) starts Google's Desktop Head Unit simulator against the phone plugged in
by USB. It says what to do on the phone first (Android Auto's menu, **Start head unit server**), waits for
a key, then opens a wide car screen; `dhu sensors` opens an 800×480 screen with simulated car data
(`fuel`, `range`, `speed`, `odometer` commands in its console). The simulator uses the computer's
microphone.

**In the simulator, Open and Close move the real gate and garage doors.** To try without them, point the
debug build at the demo server on the computer: `adb reverse tcp:9789 tcp:9789`, then the address
`http://localhost:9789` (any user name; the local network needs no account).

The approach alert can be tried without driving, with the debug build only:

```bash
adb shell am broadcast -n org.kasbah.auto.debug/org.kasbah.auto.MockLocationReceiver --ez arrive true
```

It acts as if the car had just entered the circle. The bar shows the alert for a few seconds only; it
then stays in the car's notification list.

If the simulator stays on "waiting for phone" or disconnects right after connecting, close it, restart
the head unit server on the phone, and start the script again. Quit the simulator with `quit` in its
console rather than killing it.

## Why not an app inside the car

Cars with Google built-in (Renault's openR Link, for instance) only install apps from the Play Store, and
reading tire pressure there needs a permission that third-party apps only get from Android Automotive 15
on. Android Auto, projected from the phone, needs neither. Details, in French, in the wiki:
[1_15 Appli Android Auto](../doc/1_architecture/1_15_appli-android-auto.md).
