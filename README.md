# Tray — system tray for GNOME Shell

**English** | [Русский](README.ru.md)

A GNOME Shell extension that brings back a classic system tray to the top panel,
like in KDE Plasma and Windows.

## Features

- **StatusNotifierItem / AppIndicator icons** (Telegram, Discord, Steam, Nextcloud,
  KeePassXC, Qt and Electron apps, etc.)
  - left click: activates the app or shows its window
  - right click: opens the app's menu (DBusMenu)
  - middle click: secondary action
  - mouse wheel: scroll events are passed to the app (e.g. volume control)
- **Legacy XEmbed icons** from X11/XWayland apps (Wine, older GTK2/Java apps)
- **Minimized windows** in the tray, optional (off by default)
  - left click: restores the window
  - middle click: closes the window
- Optionally hides icons whose status is *Passive*
- Follows the icon theme when it changes

## Requirements

- GNOME Shell **48, 49, 50 or 51**
- `gnome-extensions` (comes with GNOME Shell) and `glib-compile-schemas` (comes with GLib)
- `git` (or download the repository as a ZIP instead)

## Installation

```bash
git clone https://github.com/Axawys/gnome_tray.git
cd gnome_tray
./install.sh
```

Then:

- **Wayland** (the default session): log out and log back in, then enable the extension:
  ```bash
  gnome-extensions enable tray@axawys
  ```
- **X11**: press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r` and press <kbd>Enter</kbd>, or just log out and log back in.

You can also enable the extension from the **Extensions** or **Extension Manager** app.

### Installing from a ZIP archive

If a release contains `tray@axawys.shell-extension.zip`:

```bash
gnome-extensions install --force tray@axawys.shell-extension.zip
```

After that, log out and log back in, and enable the extension as shown above.

## Settings

```bash
gnome-extensions prefs tray@axawys
```

| Option | Default |
|---|---|
| Show minimized windows in the tray | off |
| Show legacy XEmbed icons | on |
| Hide passive icons | off |

The preferences window is currently in Russian only.

## Updating

```bash
cd gnome_tray
git pull
./install.sh
```

Then log out and log back in.

## Uninstalling

```bash
gnome-extensions uninstall tray@axawys
```

## Known limitations

- **Conflicts with other tray extensions.** Only one program can own the
  `org.kde.StatusNotifierWatcher` D-Bus name. If the *AppIndicator and KStatusNotifierItem
  Support* extension (or a similar one) is enabled, disable it first, otherwise
  StatusNotifierItem icons won't show up.
- Legacy XEmbed icons work only for X11/XWayland apps.

## Troubleshooting

Look at the GNOME Shell log:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i tray
```

## License

[GPL-3.0-or-later](LICENSE)
