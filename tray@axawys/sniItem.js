// Client side of org.kde.StatusNotifierItem: reads properties and follows updates.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import GdkPixbuf from 'gi://GdkPixbuf';
import St from 'gi://St';

const ITEM_IFACE = 'org.kde.StatusNotifierItem';

// Signal -> properties that must be re-read
const UPDATE_SIGNALS = {
    NewIcon: ['IconName', 'IconPixmap', 'IconThemePath'],
    NewAttentionIcon: ['AttentionIconName', 'AttentionIconPixmap'],
    NewOverlayIcon: ['OverlayIconName', 'OverlayIconPixmap'],
    NewStatus: ['Status'],
    NewTitle: ['Title'],
    NewToolTip: ['ToolTip'],
    NewIconThemePath: ['IconThemePath'],
    NewMenu: ['Menu'],
};

export const StatusNotifierItem = GObject.registerClass({
    Signals: {
        'icon-changed': {},
        'status-changed': {},
        'title-changed': {},
        'menu-changed': {},
        'ready': {},
    },
}, class StatusNotifierItem extends GObject.Object {
    constructor(busName, objectPath) {
        super();
        this.busName = busName;
        this.objectPath = objectPath;
        this._props = {};
        this._cancellable = new Gio.Cancellable();
        this._pendingProps = new Set();
        this._refreshId = 0;

        this._signalId = Gio.DBus.session.signal_subscribe(
            busName, ITEM_IFACE, null, objectPath, null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, signal) => this._onSignal(signal));

        this._propsSignalId = Gio.DBus.session.signal_subscribe(
            busName, 'org.freedesktop.DBus.Properties', 'PropertiesChanged',
            objectPath, ITEM_IFACE, Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                const [, changed] = params.deepUnpack();
                this._applyProps(changed);
            });

        this._loadAll();
    }

    get id() {
        return this._props.Id ?? '';
    }

    get title() {
        const tooltip = this._props.ToolTip;
        return this._props.Title || (tooltip ? tooltip[2] : '') || this.id;
    }

    get status() {
        return this._props.Status ?? 'Active';
    }

    get menuPath() {
        const menu = this._props.Menu;
        return menu && menu !== '/' ? menu : null;
    }

    get itemIsMenu() {
        return !!this._props.ItemIsMenu;
    }

    async _loadAll() {
        try {
            const reply = await Gio.DBus.session.call(this.busName, this.objectPath,
                'org.freedesktop.DBus.Properties', 'GetAll',
                new GLib.Variant('(s)', [ITEM_IFACE]), new GLib.VariantType('(a{sv})'),
                Gio.DBusCallFlags.NONE, -1, this._cancellable);
            const [props] = reply.deepUnpack();
            this._applyProps(props);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                log(`Tray: failed to read ${this.busName}${this.objectPath}: ${e.message}`);
        }
        if (!this._cancellable.is_cancelled())
            this.emit('ready');
    }

    _onSignal(signal) {
        const names = UPDATE_SIGNALS[signal];
        if (!names)
            return;
        names.forEach(n => this._pendingProps.add(n));

        // Some apps spam NewIcon; coalesce updates.
        if (this._refreshId)
            return;
        this._refreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._refreshId = 0;
            const pending = [...this._pendingProps];
            this._pendingProps.clear();
            this._refreshProps(pending);
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refreshProps(names) {
        const changed = {};
        await Promise.all(names.map(async name => {
            try {
                const reply = await Gio.DBus.session.call(this.busName, this.objectPath,
                    'org.freedesktop.DBus.Properties', 'Get',
                    new GLib.Variant('(ss)', [ITEM_IFACE, name]), new GLib.VariantType('(v)'),
                    Gio.DBusCallFlags.NONE, -1, this._cancellable);
                [changed[name]] = reply.deepUnpack();
            } catch {
                // Property not implemented by this item.
                changed[name] = null;
            }
        }));
        if (!this._cancellable.is_cancelled())
            this._applyProps(changed);
    }

    _applyProps(variants) {
        let icon = false, status = false, title = false, menu = false;
        for (const [name, variant] of Object.entries(variants)) {
            let value = null;
            if (variant) {
                value = name.endsWith('Pixmap')
                    ? unpackPixmaps(variant)
                    : variant.recursiveUnpack();
            }
            this._props[name] = value;

            if (name.includes('Icon'))
                icon = true;
            else if (name === 'Status')
                status = icon = true;
            else if (name === 'Title' || name === 'ToolTip' || name === 'Id')
                title = true;
            else if (name === 'Menu')
                menu = true;
        }
        if (icon)
            this.emit('icon-changed');
        if (status)
            this.emit('status-changed');
        if (title)
            this.emit('title-changed');
        if (menu)
            this.emit('menu-changed');
    }

    // Returns a Gio.Icon for the current state, or null.
    getIcon(size) {
        const attention = this.status === 'NeedsAttention';
        const name = (attention && this._props.AttentionIconName) || this._props.IconName;
        const pixmaps = (attention && this._props.AttentionIconPixmap?.length)
            ? this._props.AttentionIconPixmap : this._props.IconPixmap;

        const named = name ? lookupNamedIcon(name, this._props.IconThemePath) : null;
        if (named)
            return named;
        if (pixmaps?.length)
            return pixmapToIcon(pixmaps, size);
        return name ? new Gio.ThemedIcon({name}) : null;
    }

    _call(method, signature, args) {
        return Gio.DBus.session.call(this.busName, this.objectPath, ITEM_IFACE, method,
            new GLib.Variant(signature, args), null, Gio.DBusCallFlags.NONE, -1,
            this._cancellable);
    }

    activate(x, y) {
        return this._call('Activate', '(ii)', [x, y]);
    }

    secondaryActivate(x, y) {
        return this._call('SecondaryActivate', '(ii)', [x, y]).catch(() => {});
    }

    contextMenu(x, y) {
        return this._call('ContextMenu', '(ii)', [x, y]).catch(() => {});
    }

    scroll(delta, orientation) {
        return this._call('Scroll', '(is)', [delta, orientation]).catch(() => {});
    }

    destroy() {
        this._cancellable.cancel();
        if (this._refreshId)
            GLib.source_remove(this._refreshId);
        Gio.DBus.session.signal_unsubscribe(this._signalId);
        Gio.DBus.session.signal_unsubscribe(this._propsSignalId);
    }
});

// a(iiay) -> [{width, height, data: Uint8Array}]
function unpackPixmaps(variant) {
    const result = [];
    for (let i = 0; i < variant.n_children(); i++) {
        const child = variant.get_child_value(i);
        const width = child.get_child_value(0).get_int32();
        const height = child.get_child_value(1).get_int32();
        const data = child.get_child_value(2).get_data_as_bytes().toArray();
        if (width > 0 && height > 0 && data.length >= width * height * 4)
            result.push({width, height, data});
    }
    return result;
}

let _iconTheme = null;
function iconTheme() {
    if (!_iconTheme)
        _iconTheme = new St.IconTheme();
    return _iconTheme;
}

export function resetIconTheme() {
    _iconTheme = null;
}

const ICON_EXTENSIONS = ['png', 'svg', 'xpm'];

function findIconFile(dir, name, depth) {
    for (const ext of ICON_EXTENSIONS) {
        const file = dir.get_child(`${name}.${ext}`);
        if (file.query_exists(null))
            return file;
    }
    if (depth <= 0)
        return null;

    try {
        const enumerator = dir.enumerate_children('standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null))) {
            if (info.get_file_type() !== Gio.FileType.DIRECTORY)
                continue;
            const found = findIconFile(dir.get_child(info.get_name()), name, depth - 1);
            if (found)
                return found;
        }
    } catch {
        // unreadable directory
    }
    return null;
}

function lookupNamedIcon(name, themePath) {
    if (name.startsWith('/')) {
        const file = Gio.File.new_for_path(name);
        return file.query_exists(null) ? new Gio.FileIcon({file}) : null;
    }

    if (themePath) {
        const file = findIconFile(Gio.File.new_for_path(themePath), name, 4);
        if (file)
            return new Gio.FileIcon({file});
    }

    if (iconTheme().has_icon(name))
        return new Gio.ThemedIcon({name});
    return null;
}

function pixmapToIcon(pixmaps, size) {
    // Smallest pixmap that is at least `size`, otherwise the biggest one.
    const sorted = [...pixmaps].sort((a, b) => a.width - b.width);
    const pix = sorted.find(p => p.width >= size) ?? sorted[sorted.length - 1];

    // ARGB32 in network byte order -> RGBA
    const {width, height, data} = pix;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height * 4; i += 4) {
        rgba[i] = data[i + 1];
        rgba[i + 1] = data[i + 2];
        rgba[i + 2] = data[i + 3];
        rgba[i + 3] = data[i];
    }

    const pixbuf = GdkPixbuf.Pixbuf.new_from_bytes(new GLib.Bytes(rgba),
        GdkPixbuf.Colorspace.RGB, true, 8, width, height, width * 4);
    const [ok, png] = pixbuf.save_to_bufferv('png', [], []);
    return ok ? new Gio.BytesIcon({bytes: new GLib.Bytes(png)}) : null;
}
