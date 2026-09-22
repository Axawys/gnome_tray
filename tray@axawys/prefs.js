import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TrayPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: 'Трей'});
        page.add(group);

        const addSwitch = (key, title, subtitle) => {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        };

        addSwitch('show-minimized-windows', 'Свёрнутые окна',
            'Показывать свёрнутые окна в трее; клик разворачивает окно');
        addSwitch('show-legacy-icons', 'Старые иконки (XEmbed)',
            'Иконки X11/XWayland-приложений, например Wine');
        addSwitch('hide-passive-items', 'Скрывать пассивные иконки',
            'Скрывать иконки со статусом Passive');

        window.add(page);
    }
}
