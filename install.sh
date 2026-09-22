#!/bin/bash
# Installs the extension for the current user.
set -e

UUID=tray@axawys

for cmd in gnome-extensions glib-compile-schemas; do
    if ! command -v "$cmd" >/dev/null; then
        echo "Error: '$cmd' not found. Install GNOME Shell and GLib development tools." >&2
        exit 1
    fi
done

cd "$(dirname "$0")/$UUID"
glib-compile-schemas schemas
gnome-extensions pack --force --extra-source=watcher.js --extra-source=sniItem.js \
    --extra-source=dbusMenu.js --extra-source=trayButtons.js --out-dir=..
gnome-extensions install --force "../$UUID.shell-extension.zip"

if gnome-extensions enable "$UUID" 2>/dev/null; then
    echo "Done. The extension is installed and enabled."
else
    echo "Installed. Log out and log back in (required on Wayland), then run:"
    echo "    gnome-extensions enable $UUID"
fi
