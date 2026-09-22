// com.canonical.dbusmenu client rendered into a GNOME Shell PopupMenu.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const MENU_IFACE = 'com.canonical.dbusmenu';

function parseNode(variant) {
    // Some implementations wrap nodes more than once.
    while (variant.get_type_string() === 'v')
        variant = variant.get_variant();
    const id = variant.get_child_value(0).get_int32();
    const props = variant.get_child_value(1).deepUnpack();
    const childrenVariant = variant.get_child_value(2);
    const children = [];
    for (let i = 0; i < childrenVariant.n_children(); i++)
        children.push(parseNode(childrenVariant.get_child_value(i)));
    return {id, props, children};
}

function prop(node, name, fallback) {
    const v = node.props[name];
    return v ? v.deepUnpack() : fallback;
}

function stripMnemonic(label) {
    return label.replace(/__/g, '\0').replace(/_/g, '').replace(/\0/g, '_');
}

export class DBusMenu {
    constructor(busName, objectPath, menu) {
        this._busName = busName;
        this._objectPath = objectPath;
        this._menu = menu;
        this._cancellable = new Gio.Cancellable();
        this._updateId = 0;
        this._root = null;

        this._signalId = Gio.DBus.session.signal_subscribe(
            busName, MENU_IFACE, null, objectPath, null, Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, signal) => {
                if (signal === 'LayoutUpdated' || signal === 'ItemsPropertiesUpdated')
                    this._queueUpdate();
            });

        this._openStateId = menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._aboutToShow(0);
            this._event(0, open ? 'opened' : 'closed');
        });

        this._update();
    }

    _call(method, signature, args, replyType = null) {
        return Gio.DBus.session.call(this._busName, this._objectPath, MENU_IFACE, method,
            args ? new GLib.Variant(signature, args) : null,
            replyType ? new GLib.VariantType(replyType) : null,
            Gio.DBusCallFlags.NONE, -1, this._cancellable);
    }

    _event(id, eventId) {
        this._call('Event', '(isvu)',
            [id, eventId, new GLib.Variant('i', 0), global.get_current_time()])
            .catch(() => {});
    }

    async _aboutToShow(id) {
        try {
            const reply = await this._call('AboutToShow', '(i)', [id], '(b)');
            const [needUpdate] = reply.deepUnpack();
            if (needUpdate)
                this._queueUpdate();
        } catch {
            // optional method
        }
    }

    _queueUpdate() {
        if (this._updateId)
            return;
        this._updateId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 30, () => {
            this._updateId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _update() {
        let root;
        try {
            const reply = await this._call('GetLayout', '(iias)', [0, -1, []], '(u(ia{sv}av))');
            root = parseNode(reply.get_child_value(1));
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                log(`Tray: failed to get menu of ${this._busName}: ${e.message}`);
            return;
        }
        if (this._cancellable.is_cancelled())
            return;

        this._root = root;
        this._menu.removeAll();
        this._fill(this._menu, root.children);
    }

    // Finds a visible, enabled top-level leaf item whose label matches the predicate.
    findItem(predicate) {
        return this._root?.children.find(node =>
            prop(node, 'visible', true) && prop(node, 'enabled', true) &&
            prop(node, 'type', 'standard') !== 'separator' && !node.children.length &&
            predicate(stripMnemonic(prop(node, 'label', ''))))?.id ?? null;
    }

    activateItem(id) {
        this._event(id, 'clicked');
    }

    _fill(menu, nodes) {
        let lastWasSeparator = true;
        for (const node of nodes) {
            if (!prop(node, 'visible', true))
                continue;

            if (prop(node, 'type', 'standard') === 'separator') {
                if (!lastWasSeparator)
                    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                lastWasSeparator = true;
                continue;
            }
            lastWasSeparator = false;

            const label = stripMnemonic(prop(node, 'label', ''));
            const enabled = prop(node, 'enabled', true);
            let item;

            if (prop(node, 'children-display', '') === 'submenu' || node.children.length) {
                item = new PopupMenu.PopupSubMenuMenuItem(label);
                this._fill(item.menu, node.children);
                item.menu.connect('open-state-changed', (_m, open) => {
                    if (open)
                        this._aboutToShow(node.id);
                    this._event(node.id, open ? 'opened' : 'closed');
                });
            } else {
                item = new PopupMenu.PopupMenuItem(label);
                item.connect('activate', () => this._event(node.id, 'clicked'));
                this._setToggle(item, node);
            }

            this._setIcon(item, node);
            item.setSensitive(enabled);
            menu.addMenuItem(item);
        }
    }

    _setToggle(item, node) {
        const type = prop(node, 'toggle-type', '');
        const state = prop(node, 'toggle-state', 0) === 1;
        if (type === 'checkmark')
            item.setOrnament(state ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        else if (type === 'radio')
            item.setOrnament(state ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
    }

    _setIcon(item, node) {
        let gicon = null;
        const iconName = prop(node, 'icon-name', '');
        const iconData = node.props['icon-data'];
        if (iconName) {
            gicon = new Gio.ThemedIcon({name: iconName});
        } else if (iconData) {
            const bytes = iconData.get_data_as_bytes();
            if (bytes.get_size() > 0)
                gicon = new Gio.BytesIcon({bytes});
        }
        if (!gicon)
            return;

        const icon = new St.Icon({
            gicon,
            style_class: 'popup-menu-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Put the icon right after the ornament, before the label.
        const labelIndex = item.get_children().indexOf(item.label);
        item.insert_child_at_index(icon, Math.max(labelIndex, 0));
    }

    destroy() {
        this._cancellable.cancel();
        if (this._updateId)
            GLib.source_remove(this._updateId);
        Gio.DBus.session.signal_unsubscribe(this._signalId);
        this._menu.disconnect(this._openStateId);
    }
}
