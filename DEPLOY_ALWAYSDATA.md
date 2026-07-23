# Бесплатная публикация backend на alwaysdata

Инструкция рассчитана на Windows и не требует собственного сервера.

## 1. Что получится

```text
GitHub Pages
    ↓ POST /api/comtrade
https://ИМЯ-АККАУНТА.alwaysdata.net
    ↓ последовательные запросы
https://comtradeapi.un.org
```

alwaysdata запускает обычный Node.js-процесс. Поэтому крупный ответ передаётся
потоком и не упирается в небольшой лимит ответа serverless-функции.

## 2. Создайте бесплатный аккаунт

1. Откройте `https://www.alwaysdata.com/en/register/`.
2. Выберите предложение **Free — 0 € / month**.
3. Зарегистрируйте профиль.
4. Создайте account и запишите его короткое имя. Далее оно обозначается как
   `ИМЯ-АККАУНТА`.
5. Для бесплатного предложения банковская карта не требуется.

Технический адрес будущего backend:

```text
https://ИМЯ-АККАУНТА.alwaysdata.net
```

## 3. Загрузите готовый backend

В сборке уже есть файл:

```text
deploy/comtrade-backend-alwaysdata.zip
```

### Вариант через FileZilla

1. Установите FileZilla Client: `https://filezilla-project.org/`.
2. В панели alwaysdata откройте **Remote access → SSH**.
3. Если SSH-пользователь ещё не создан, добавьте его с доступом к корню
   аккаунта.
4. В FileZilla откройте **File → Site Manager → New site**.
5. Укажите:

   | Поле | Значение |
   |---|---|
   | Protocol | SFTP — SSH File Transfer Protocol |
   | Host | `ssh-ИМЯ-АККАУНТА.alwaysdata.net` |
   | Port | `22` |
   | Logon Type | Normal |
   | User | имя SSH-пользователя |
   | Password | пароль SSH-пользователя |

6. Подключитесь и загрузите `comtrade-backend-alwaysdata.zip` в каталог
   `/home/ИМЯ-АККАУНТА/`.

## 4. Распакуйте файлы и установите зависимости

1. Откройте в браузере:

   ```text
   https://ssh-ИМЯ-АККАУНТА.alwaysdata.net
   ```

2. Войдите тем же SSH-пользователем.
3. Последовательно выполните:

   ```bash
   mkdir -p ~/comtrade-backend
   unzip -o ~/comtrade-backend-alwaysdata.zip -d ~/comtrade-backend
   cd ~/comtrade-backend
   npm ci --omit=dev
   npm test
   ```

Ожидаемый результат последней команды: все тесты завершились со статусом
`pass`.

Если команда `node --version` показывает не 22.x:

1. Откройте **Environment → Node.js**.
2. Выберите Node.js 22.
3. Повторите `npm ci --omit=dev` и `npm test`.

## 5. Создайте Node.js-сайт

1. В панели alwaysdata откройте **Web → Sites**.
2. Нажмите **Add a site**.
3. Заполните:

   | Поле | Значение |
   |---|---|
   | Name | `UN Comtrade backend` |
   | Addresses | `ИМЯ-АККАУНТА.alwaysdata.net` |
   | Type | `Node.js` |
   | Command | `node /home/ИМЯ-АККАУНТА/comtrade-backend/server.js` |
   | Working directory | `/home/ИМЯ-АККАУНТА/comtrade-backend` |

Не задавайте `IP` и `PORT` вручную: alwaysdata передаёт их приложению
автоматически.

## 6. Добавьте переменные окружения

В настройках созданного сайта найдите поле **Environment** и добавьте:

```text
NODE_ENV=production
MAX_RECORDS=50000
REQUEST_INTERVAL_MS=1100
UPSTREAM_TIMEOUT_MS=180000
MAX_RETRIES=3
CACHE_TTL_MS=21600000
CACHE_MAX_ENTRIES=50
CACHE_MAX_ENTRY_BYTES=2097152
CACHE_MAX_TOTAL_BYTES=33554432
ALLOWED_ORIGINS=https://ВАШ-ЛОГИН-GITHUB.github.io
```

Если интерфейс GitHub Pages работает на собственном домене, укажите этот origin:

```text
ALLOWED_ORIGINS=https://dashboard.example.ru
```

Правила для `ALLOWED_ORIGINS`:

- только `https://` и имя хоста;
- без завершающего `/`;
- без подпапки репозитория;
- несколько origin разделяются запятыми.

Пример:

```text
ALLOWED_ORIGINS=https://username.github.io,https://dashboard.example.ru
```

Для первоначальной диагностики можно временно установить:

```text
ALLOWED_ORIGINS=*
```

После успешной проверки лучше вернуть точный адрес GitHub Pages.

## 7. Запустите и проверьте backend

1. Сохраните сайт.
2. Нажмите **Restart**, если он не перезапустился автоматически.
3. Откройте:

   ```text
   https://ИМЯ-АККАУНТА.alwaysdata.net/health
   ```

Ожидаемый ответ:

```json
{
  "ok": true,
  "service": "UN Comtrade proxy",
  "maxRecords": 50000,
  "requestIntervalMs": 1100,
  "queuePending": 0,
  "cacheEntries": 0,
  "cacheBytes": 0
}
```

Если страница не открывается:

1. Откройте **Web → Sites → UN Comtrade backend → Logs**.
2. Проверьте правильность `ИМЯ-АККАУНТА` в Command и Working directory.
3. Убедитесь, что `npm ci --omit=dev` завершился без ошибки.
4. Проверьте, что используется Node.js 22.

## 8. Подключите GitHub Pages

1. Откройте репозиторий конструктора в GitHub.
2. Перейдите в **Settings → Secrets and variables → Actions → Variables**.
3. Создайте или измените переменную:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_COMTRADE_PROXY_URL` | `https://ИМЯ-АККАУНТА.alwaysdata.net/api/comtrade` |

4. Откройте **Actions → Deploy to GitHub Pages**.
5. Нажмите **Run workflow → Run workflow**.
6. Дождитесь зелёного статуса.
7. Откройте конструктор и нажмите `Ctrl+F5`.

## 9. Финальная проверка без VPN

Проверьте с российского подключения:

1. `https://ИМЯ-АККАУНТА.alwaysdata.net/health` открывается быстро.
2. В конструкторе выполняется проверка количества строк.
3. Запрос с API-ключом получает данные.
4. В DevTools → Network обращения идут только:
   - к домену GitHub Pages;
   - к `ИМЯ-АККАУНТА.alwaysdata.net`;
   - сервер затем обращается к `comtradeapi.un.org`.

## 10. Обновление backend в будущем

1. Загрузите новую версию `comtrade-backend-alwaysdata.zip` через SFTP.
2. В веб-терминале выполните:

   ```bash
   unzip -o ~/comtrade-backend-alwaysdata.zip -d ~/comtrade-backend
   cd ~/comtrade-backend
   npm ci --omit=dev
   npm test
   ```

3. В панели **Web → Sites** нажмите **Restart**.

## 11. Важные ограничения

- Бесплатное предложение предназначено для персонального использования.
- Ресурсы бесплатного тарифа: 256 МБ RAM, 1 ГБ SSD и 1/4 CPU.
- Backend специально ограничивает оперативный кэш 32 МБ.
- Большие ответы не кэшируются, а сразу передаются браузеру потоком.
- API-ключ UN Comtrade не нужно добавлять в переменные хостинга.
- Один backend должен обслуживаться одним Node.js-процессом.
