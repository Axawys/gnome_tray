import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {StatusNotifierWatcher} from './watcher.js';
import {StatusNotifierItem, resetIconTheme} from './sniItem.js';
import {SniButton, WindowButton, LegacyButton} from './trayButtons.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call');

const TRAY_WINDOW_TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG];

export default class TrayExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Minimized windows on the left, application icons on the right (as in Windows).
        this._box = new St.BoxLayout({style_class: 'tray-axawys-box'});
        this._windowBox = new St.BoxLayout({style_class: 'tray-axawys-windows'});
        this._iconBox = new St.BoxLayout({style_class: 'tray-axawys-icons'});
        this._box.add_child(this._windowBox);
        this._box.add_child(this._iconBox);
        Main.panel._rightBox.insert_child_at_index(this._box, 0);

        this._settings.connectObject(
            'changed::show-minimized-windows', () => this._syncWindowTracking(),
            'changed::show-legacy-icons', () => this._syncLegacyTray(),
            this);
        St.TextureCache.get_default().connectObject('icon-theme-changed', () => {
            resetIconTheme();
            for (const {button} of this._sniItems.values())
                button._updateIcon();
        }, this);

        // StatusNotifierItem / AppIndicator
        this._sniItems = new Map();
        this._watcher = new StatusNotifierWatcher(
            (id, busName, path) => this._addSniItem(id, busName, path),
            id => this._removeSniItem(id));

        // Minimized windows
        this._windowButtons = new Map();
        this._syncWindowTracking();

        // Legacy XEmbed
        this._legacyButtons = new Map();
        this._trayManager = null;
        this._syncLegacyTray();
    }

    disable() {
        this._settings.disconnectObject(this);
        St.TextureCache.get_default().disconnectObject(this);

        this._watcher.destroy();
        this._watcher = null;
        for (const id of [...this._sniItems.keys()])
            this._removeSniItem(id);

        this._stopWindowTracking();
        this._stopLegacyTray();

        this._box.destroy();
        this._box = this._windowBox = this._iconBox = null;
        this._settings = null;
    }

    // --- StatusNotifierItem ---

    _addSniItem(id, busName, path) {
        const item = new StatusNotifierItem(busName, path);
        const entry = {item, button: null};
        this._sniItems.set(id, entry);

        // Create the button once properties are known to avoid a flash of a missing icon.
        item.connectObject('ready', () => {
            item.disconnectObject(this);
            if (this._sniItems.get(id) !== entry || entry.button)
                return;
            entry.button = new SniButton(item, this._settings);
            this._iconBox.add_child(entry.button.container);
        }, this);
    }

    _removeSniItem(id) {
        const entry = this._sniItems.get(id);
        if (!entry)
            return;
        this._sniItems.delete(id);
        entry.item.disconnectObject(this);
        entry.button?.destroy();
        entry.item.destroy();
    }

    // --- Minimized windows ---

    _syncWindowTracking() {
        const enabled = this._settings.get_boolean('show-minimized-windows');
        if (enabled && !this._trackingWindows) {
            this._trackingWindows = true;
            global.display.connectObject('window-created',
                (_d, window) => this._trackWindow(window), this);
            for (const actor of global.get_window_actors())
                this._trackWindow(actor.meta_window);
        } else if (!enabled && this._trackingWindows) {
            this._stopWindowTracking();
        }
    }

    _stopWindowTracking() {
        if (!this._trackingWindows)
            return;
        this._trackingWindows = false;
        global.display.disconnectObject(this);
        for (const actor of global.get_window_actors())
            actor.meta_window.disconnectObject(this);
        for (const button of this._windowButtons.values())
            button.destroy();
        this._windowButtons.clear();
    }

    _trackWindow(window) {
        window.connectObject(
            'notify::minimized', () => this._syncWindow(window),
            'notify::skip-taskbar', () => this._syncWindow(window),
            'unmanaged', () => {
                window.disconnectObject(this);
                this._removeWindowButton(window);
            },
            this);
        this._syncWindow(window);
    }

    _syncWindow(window) {
        const show = window.minimized &&
            !window.skip_taskbar &&
            TRAY_WINDOW_TYPES.includes(window.get_window_type());

        if (show && !this._windowButtons.has(window)) {
            const button = new WindowButton(window);
            this._windowButtons.set(window, button);
            this._windowBox.add_child(button.container);
        } else if (!show) {
            this._removeWindowButton(window);
        }
    }

    _removeWindowButton(window) {
        const button = this._windowButtons.get(window);
        if (!button)
            return;
        this._windowButtons.delete(window);
        button.destroy();
    }

    // --- Legacy XEmbed tray ---

    _syncLegacyTray() {
        const enabled = this._settings.get_boolean('show-legacy-icons');
        if (enabled && !this._trayManager)
            this._startLegacyTray();
        else if (!enabled && this._trayManager)
            this._stopLegacyTray();
    }

    _startLegacyTray() {
        if (!Shell.TrayManager)
            return;
        try {
            this._trayManager = new Shell.TrayManager();
            this._trayManager.connectObject(
                'tray-icon-added', (_tm, icon) => {
                    const button = new LegacyButton(icon);
                    this._legacyButtons.set(icon, button);
                    this._iconBox.add_child(button.container);
                },
                'tray-icon-removed', (_tm, icon) => {
                    this._legacyButtons.get(icon)?.destroy();
                    this._legacyButtons.delete(icon);
                },
                this);
            this._trayManager.manage_screen(Main.panel);
        } catch (e) {
            logError(e, 'Tray: legacy tray is unavailable');
            this._trayManager = null;
        }
    }

    _stopLegacyTray() {
        for (const button of this._legacyButtons.values())
            button.destroy();
        this._legacyButtons.clear();
        if (this._trayManager) {
            this._trayManager.disconnectObject(this);
            this._trayManager.unmanage_screen();
            this._trayManager = null;
        }
    }
}
