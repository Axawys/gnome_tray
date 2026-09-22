# Tray — системный трей для GNOME Shell

[English](README.md) | **Русский**

Расширение GNOME Shell, которое возвращает на верхнюю панель привычный системный трей,
как в KDE Plasma и Windows.

## Возможности

- **Иконки StatusNotifierItem / AppIndicator** (Telegram, Discord, Steam, Nextcloud,
  KeePassXC, Qt- и Electron-приложения и т.д.)
  - левый клик: активирует приложение или показывает его окно
  - правый клик: открывает меню приложения (DBusMenu)
  - средний клик: дополнительное действие
  - колесо мыши: прокрутка передаётся приложению (например, для громкости)
- **Старые иконки XEmbed** от X11/XWayland-приложений (Wine, старые GTK2/Java-приложения)
- **Свёрнутые окна** в трее, по желанию (по умолчанию выключено)
  - левый клик: разворачивает окно
  - средний клик: закрывает окно
- Можно скрывать иконки со статусом *Passive*
- Иконки обновляются при смене темы иконок

## Требования

- GNOME Shell **48, 49, 50 или 51**
- `gnome-extensions` (есть в составе GNOME Shell) и `glib-compile-schemas` (есть в составе GLib)
- `git` (или скачайте репозиторий ZIP-архивом)

## Установка

```bash
git clone https://github.com/Axawys/gnome_tray.git
cd gnome_tray
./install.sh
```

Затем:

- **Wayland** (сессия по умолчанию): выйдите из сессии, войдите снова и включите расширение:
  ```bash
  gnome-extensions enable tray@axawys
  ```
- **X11**: нажмите <kbd>Alt</kbd>+<kbd>F2</kbd>, введите `r` и нажмите <kbd>Enter</kbd> или просто перезайдите в сессию.

Включить расширение можно и в приложении **Расширения** (Extensions) или **Extension Manager**.

### Установка из ZIP-архива

Если в релизе есть файл `tray@axawys.shell-extension.zip`:

```bash
gnome-extensions install --force tray@axawys.shell-extension.zip
```

После этого перезайдите в сессию и включите расширение, как описано выше.

## Настройки

```bash
gnome-extensions prefs tray@axawys
```

| Параметр | По умолчанию |
|---|---|
| Свёрнутые окна в трее | выкл. |
| Старые иконки (XEmbed) | вкл. |
| Скрывать пассивные иконки | выкл. |

## Обновление

```bash
cd gnome_tray
git pull
./install.sh
```

Затем перезайдите в сессию.

## Удаление

```bash
gnome-extensions uninstall tray@axawys
```

## Известные ограничения

- **Конфликт с другими расширениями трея.** D-Bus-имя `org.kde.StatusNotifierWatcher`
  может занимать только одна программа. Если включено расширение *AppIndicator and
  KStatusNotifierItem Support* или похожее, сначала отключите его, иначе иконки
  StatusNotifierItem не появятся.
- Старые иконки XEmbed работают только для X11/XWayland-приложений.

## Если что-то не работает

Смотрите журнал GNOME Shell:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep -i tray
```

## Лицензия

[GPL-3.0-or-later](LICENSE)
