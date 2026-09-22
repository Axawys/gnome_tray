// Panel buttons for tray entries.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {DBusMenu} from './dbusMenu.js';

const TOOLTIP_DELAY_MS = 500;
// Standard panel icon size (.system-status-icon)
const ICON_SIZE = 16;
// Menu entries that bring up the main window: "Show window", "Open Telegram", "Показать", ...
const SHOW_ITEM_RE = /^(show|open|restore|показать|открыть|развернуть)(?:\s+(.*))?$/i;
const WINDOW_WORDS = ['window', 'main window', 'окно', 'главное окно'];

const TrayButton = GObject.registerClass(
class TrayButton extends PanelMenu.Button {
    _init(name) {
        super._init(0.5, name);
        // GNOME 49+ toggles the menu from a ClickGesture on any press; we route clicks ourselves.
        if (this._clickGesture)
            this.remove_action(this._clickGesture);
        this.add_style_class_name('tray-axawys-button');
        this._tooltipText = '';
        this._tooltip = null;
        this._tooltipId = 0;

        this.connect('notify::hover', () => this._syncTooltip());
        this.menu.connect('open-state-changed', () => this._hideTooltip());
        Main.panel.menuManager.addMenu(this.menu);
    }

    setTooltip(text) {
        this._tooltipText = text ?? '';
        if (this._tooltip)
            this._tooltip.text = this._tooltipText;
    }

    _syncTooltip() {
        if (this.hover && this._tooltipText && !this.menu.isOpen) {
            if (!this._tooltipId) {
                this._tooltipId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, () => {
                    this._tooltipId = 0;
                    this._showTooltip();
                    return GLib.SOURCE_REMOVE;
                });
            }
        } else {
            this._hideTooltip();
        }
    }

    _showTooltip() {
        if (!this._tooltip) {
            this._tooltip = new St.Label({style_class: 'dash-label tray-axawys-tooltip'});
            Main.uiGroup.add_child(this._tooltip);
        }
        this._tooltip.text = this._tooltipText;
        this._tooltip.show();

        const [x, y] = this.get_transformed_position();
        const [w, h] = this.get_transformed_size();
        const [tw] = this._tooltip.get_preferred_width(-1);
        const monitor = Main.layoutManager.findMonitorForActor(this);
        let tx = Math.round(x + w / 2 - tw / 2);
        if (monitor)
            tx = Math.max(monitor.x + 4, Math.min(tx, monitor.x + monitor.width - tw - 4));
        this._tooltip.set_position(tx, Math.round(y + h + 4));
    }

    _hideTooltip() {
        if (this._tooltipId) {
            GLib.source_remove(this._tooltipId);
            this._tooltipId = 0;
        }
        this._tooltip?.hide();
    }

    vfunc_event(event) {
        const type = event.type();
        if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN)
            this._hideTooltip();

        if (type === Clutter.EventType.BUTTON_PRESS)
            return this.onPress(event.get_button(), event);
        if (type === Clutter.EventType.BUTTON_RELEASE)
            return this.onRelease(event.get_button(), event);
        if (type === Clutter.EventType.TOUCH_BEGIN)
            return this.onRelease(Clutter.BUTTON_PRIMARY, event);
        if (type === Clutter.EventType.SCROLL)
            return this.onScroll(event);
        return Clutter.EVENT_PROPAGATE;
    }

    // Menus open on press (like the rest of the panel), actions fire on release.
    onPress(button, _event) {
        if (button === Clutter.BUTTON_SECONDARY && this.hasMenu()) {
            this.menu.toggle();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    onRelease(_button, _event) {
        return Clutter.EVENT_PROPAGATE;
    }

    onScroll(_event) {
        return Clutter.EVENT_PROPAGATE;
    }

    hasMenu() {
        return !this.menu.isEmpty();
    }

    _onDestroy() {
        this._hideTooltip();
        this._tooltip?.destroy();
        this._tooltip = null;
        super._onDestroy();
    }
});

// StatusNotifierItem / AppIndicator
export const SniButton = GObject.registerClass(
class SniButton extends TrayButton {
    _init(item, settings) {
        super._init(`tray-sni-${item.busName}${item.objectPath}`);
        this._item = item;
        this._settings = settings;
        this._dbusMenu = null;

        this._icon = new St.Icon({style_class: 'system-status-icon tray-axawys-icon'});
        this.add_child(this._icon);

        item.connectObject(
            'icon-changed', () => this._updateIcon(),
            'status-changed', () => this._updateVisibility(),
            'title-changed', () => this.setTooltip(item.title),
            'menu-changed', () => this._updateMenu(),
            this);
        settings.connectObject(
            'changed::hide-passive-items', () => this._updateVisibility(),
            this);

        this._updateIcon();
        this._updateVisibility();
        this._updateMenu();
        this.setTooltip(item.title);
    }

    _updateIcon() {
        let gicon = null;
        try {
            gicon = this._item.getIcon(ICON_SIZE * this.get_resource_scale());
        } catch (e) {
            logError(e, 'Tray: failed to build icon');
        }
        this._icon.gicon = gicon ?? new Gio.ThemedIcon({name: 'image-missing'});
    }

    _updateVisibility() {
        const passive = this._item.status === 'Passive';
        this.visible = !(passive && this._settings.get_boolean('hide-passive-items'));
    }

    _updateMenu() {
        this._dbusMenu?.destroy();
        this._dbusMenu = null;
        this.menu.removeAll();

        const path = this._item.menuPath;
        if (path)
            this._dbusMenu = new DBusMenu(this._item.busName, path, this.menu);
    }

    _coords(event) {
        const [x, y] = event.get_coords();
        return [Math.round(x), Math.round(y)];
    }

    onPress(button, event) {
        if (button === Clutter.BUTTON_SECONDARY && !this.hasMenu()) {
            this._item.contextMenu(...this._coords(event));
            return Clutter.EVENT_STOP;
        }
        return super.onPress(button, event);
    }

    onRelease(button, event) {
        const [x, y] = this._coords(event);
        if (button === Clutter.BUTTON_PRIMARY) {
            // Many apps (e.g. Qt ones) ignore Activate but offer "Show window" in the menu.
            const showId = this._findShowItem();
            if (showId !== null) {
                this._dbusMenu.activateItem(showId);
                return Clutter.EVENT_STOP;
            }
            this._item.activate(x, y).catch(() => {
                // Activate is not implemented (typical for libappindicator and
                // ItemIsMenu items): bring up the application's windows ourselves.
                this._showAppWindows().catch(e => logError(e, 'Tray: failed to show app'));
            });
            return Clutter.EVENT_STOP;
        }
        if (button === Clutter.BUTTON_MIDDLE) {
            this._item.secondaryActivate(x, y);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _findShowItem() {
        const names = [this._item.title, this._item.id]
            .filter(Boolean).map(n => n.toLowerCase());
        return this._dbusMenu?.findItem(label => {
            const match = SHOW_ITEM_RE.exec(label.trim());
            if (!match)
                return false;
            const rest = (match[2] ?? '').trim().toLowerCase();
            return !rest || WINDOW_WORDS.includes(rest) ||
                names.some(n => n.includes(rest) || rest.includes(n));
        }) ?? null;
    }

    async _showAppWindows() {
        const reply = await Gio.DBus.session.call('org.freedesktop.DBus',
            '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'GetConnectionUnixProcessID',
            new GLib.Variant('(s)', [this._item.busName]), new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE, -1, null);
        const [pid] = reply.deepUnpack();

        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, null)
            .filter(w => w.get_pid() === pid);
        if (windows.length) {
            Main.activateWindow(windows[0]);
            return;
        }

        // No mapped windows (hidden to tray): ask the application to show itself.
        const app = Shell.WindowTracker.get_default().get_app_from_pid(pid);
        app?.activate();
    }

    onScroll(event) {
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP:
            this._item.scroll(120, 'vertical');
            break;
        case Clutter.ScrollDirection.DOWN:
            this._item.scroll(-120, 'vertical');
            break;
        case Clutter.ScrollDirection.LEFT:
            this._item.scroll(-120, 'horizontal');
            break;
        case Clutter.ScrollDirection.RIGHT:
            this._item.scroll(120, 'horizontal');
            break;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
        return Clutter.EVENT_STOP;
    }

    _onDestroy() {
        this._dbusMenu?.destroy();
        this._dbusMenu = null;
        this._item.disconnectObject(this);
        this._settings.disconnectObject(this);
        super._onDestroy();
    }
});

// A minimized window
export const WindowButton = GObject.registerClass(
class WindowButton extends TrayButton {
    _init(window) {
        super._init(`tray-window-${window.get_id()}`);
        this._window = window;

        this._icon = new St.Icon({style_class: 'system-status-icon tray-axawys-icon'});
        this.add_child(this._icon);

        const restore = new PopupMenu.PopupMenuItem('Развернуть');
        restore.connect('activate', () => this._restore());
        this.menu.addMenuItem(restore);
        const close = new PopupMenu.PopupMenuItem('Закрыть');
        close.connect('activate', () => window.delete(global.get_current_time()));
        this.menu.addMenuItem(close);

        window.connectObject(
            'notify::title', () => this.setTooltip(window.get_title()),
            'notify::wm-class', () => this._updateIcon(),
            this);
        this._updateIcon();
        this.setTooltip(window.get_title());
    }

    _updateIcon() {
        const app = Shell.WindowTracker.get_default().get_window_app(this._window);
        this._icon.gicon = app?.get_icon() ?? new Gio.ThemedIcon({name: 'application-x-executable'});
    }

    _restore() {
        Main.activateWindow(this._window);
    }

    onRelease(button, _event) {
        if (button === Clutter.BUTTON_PRIMARY) {
            this._restore();
            return Clutter.EVENT_STOP;
        }
        if (button === Clutter.BUTTON_MIDDLE) {
            this._window.delete(global.get_current_time());
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _onDestroy() {
        this._window.disconnectObject(this);
        super._onDestroy();
    }
});

// Legacy XEmbed icon (X11 / XWayland apps, Wine, ...)
export const LegacyButton = GObject.registerClass(
class LegacyButton extends TrayButton {
    _init(trayIcon) {
        super._init(`tray-legacy-${trayIcon.wm_class}`);
        this._trayIcon = trayIcon;

        this._iconBin = new St.Bin({y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._iconBin);
        this._iconBin.set_child(trayIcon);

        const size = ICON_SIZE * St.ThemeContext.get_for_stage(global.stage).scale_factor;
        trayIcon.set_size(size, size);
        this.setTooltip(trayIcon.title || trayIcon.wm_class);
    }

    onPress(_button, _event) {
        return Clutter.EVENT_STOP;
    }

    onRelease(_button, event) {
        this._trayIcon.click(event);
        return Clutter.EVENT_STOP;
    }

    _onDestroy() {
        // The tray icon is owned by Shell.TrayManager.
        if (this._trayIcon.get_parent() === this._iconBin)
            this._iconBin.remove_child(this._trayIcon);
        super._onDestroy();
    }
});
