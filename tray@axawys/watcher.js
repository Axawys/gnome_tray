// org.kde.StatusNotifierWatcher implementation.
// Applications (Qt, Electron, libappindicator, ...) register their tray items here.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const WATCHER_BUS_NAME = 'org.kde.StatusNotifierWatcher';
const WATCHER_OBJECT_PATH = '/StatusNotifierWatcher';
const DEFAULT_ITEM_PATH = '/StatusNotifierItem';

const WATCHER_XML = `
<node>
  <interface name="org.kde.StatusNotifierWatcher">
    <method name="RegisterStatusNotifierItem">
      <arg type="s" direction="in" name="service"/>
    </method>
    <method name="RegisterStatusNotifierHost">
      <arg type="s" direction="in" name="service"/>
    </method>
    <property name="RegisteredStatusNotifierItems" type="as" access="read"/>
    <property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
    <property name="ProtocolVersion" type="i" access="read"/>
    <signal name="StatusNotifierItemRegistered">
      <arg type="s" name="service"/>
    </signal>
    <signal name="StatusNotifierItemUnregistered">
      <arg type="s" name="service"/>
    </signal>
    <signal name="StatusNotifierHostRegistered"/>
    <signal name="StatusNotifierHostUnregistered"/>
  </interface>
</node>`;

export class StatusNotifierWatcher {
    // onAdded(id, busName, objectPath), onRemoved(id)
    constructor(onAdded, onRemoved) {
        this._onAdded = onAdded;
        this._onRemoved = onRemoved;
        this._items = new Map(); // id -> {busName, path, watchId}
        this._cancellable = new Gio.Cancellable();

        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(WATCHER_XML, this);
        this._dbusImpl.export(Gio.DBus.session, WATCHER_OBJECT_PATH);

        this._ownNameId = Gio.bus_own_name_on_connection(
            Gio.DBus.session, WATCHER_BUS_NAME, Gio.BusNameOwnerFlags.NONE,
            () => this._onNameAcquired(),
            () => this._onNameLost());
    }

    get RegisteredStatusNotifierItems() {
        return [...this._items.values()].map(i => `${i.busName}${i.path}`);
    }

    get IsStatusNotifierHostRegistered() {
        return true;
    }

    get ProtocolVersion() {
        return 0;
    }

    RegisterStatusNotifierItemAsync([service], invocation) {
        const sender = invocation.get_sender();
        let busName, path;

        if (service.startsWith('/')) {
            // libappindicator passes an object path, the bus name is the sender
            busName = sender;
            path = service;
        } else {
            busName = service;
            path = DEFAULT_ITEM_PATH;
        }

        if (!Gio.dbus_is_name(busName)) {
            invocation.return_dbus_error('org.freedesktop.DBus.Error.InvalidArgs',
                `Invalid service: ${service}`);
            return;
        }

        this._addItem(busName, path);
        invocation.return_value(null);
    }

    RegisterStatusNotifierHostAsync(_params, invocation) {
        // We are the only host; nothing to do.
        invocation.return_value(null);
    }

    _onNameAcquired() {
        this._dbusImpl.emit_signal('StatusNotifierHostRegistered', null);
        this._seekExistingItems().catch(e => logError(e, 'Tray: scanning items'));
    }

    _onNameLost() {
        log(`Tray: could not own ${WATCHER_BUS_NAME}; another tray (e.g. AppIndicator extension) is running`);
    }

    // Items registered before the watcher appeared (e.g. after a shell restart).
    async _seekExistingItems() {
        const reply = await Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus',
            'ListNames', null, new GLib.VariantType('(as)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable);
        const [names] = reply.deepUnpack();
        for (const name of names) {
            if (name.startsWith('org.kde.StatusNotifierItem-'))
                this._addItem(name, DEFAULT_ITEM_PATH);
        }
    }

    _addItem(busName, path) {
        const id = `${busName}${path}`;
        if (this._items.has(id))
            return;

        const watchId = Gio.bus_watch_name_on_connection(Gio.DBus.session,
            busName, Gio.BusNameWatcherFlags.NONE, null,
            () => this._removeItem(id));
        this._items.set(id, {busName, path, watchId});

        this._onAdded(id, busName, path);
        this._dbusImpl.emit_signal('StatusNotifierItemRegistered',
            new GLib.Variant('(s)', [id]));
        this._dbusImpl.emit_property_changed('RegisteredStatusNotifierItems',
            new GLib.Variant('as', this.RegisteredStatusNotifierItems));
    }

    _removeItem(id) {
        const item = this._items.get(id);
        if (!item)
            return;

        Gio.bus_unwatch_name(item.watchId);
        this._items.delete(id);

        this._onRemoved(id);
        this._dbusImpl.emit_signal('StatusNotifierItemUnregistered',
            new GLib.Variant('(s)', [id]));
        this._dbusImpl.emit_property_changed('RegisteredStatusNotifierItems',
            new GLib.Variant('as', this.RegisteredStatusNotifierItems));
    }

    destroy() {
        this._cancellable.cancel();
        for (const item of this._items.values())
            Gio.bus_unwatch_name(item.watchId);
        this._items.clear();

        this._dbusImpl.emit_signal('StatusNotifierHostUnregistered', null);
        this._dbusImpl.unexport();
        Gio.bus_unown_name(this._ownNameId);
    }
}
