# Бесплатный backend на alwaysdata

GitHub Pages не выполняет серверный код, поэтому запросы к UN Comtrade передаются через обычное Node.js-приложение. Backend выполняет запросы строго последовательно, выдерживает интервал 1,1 секунды, повторяет временные ошибки и потоково отдаёт крупные ответы.

## 1. Создание аккаунта

1. Зарегистрируйте бесплатный аккаунт на `https://www.alwaysdata.com/`.
2. Откройте панель управления.
3. Запомните имя аккаунта — оно используется в адресе `https://ИМЯ.alwaysdata.net`.

## 2. Загрузка backend

1. Загрузите архив `deploy/comtrade-backend-alwaysdata-50000.zip` в домашнюю папку аккаунта через файловый менеджер или SFTP.
2. Распакуйте его в папку `comtrade-backend`.
3. В SSH-консоли выполните в этой папке:

```bash
npm ci --omit=dev
```

## 3. Создание сайта Node.js

В панели alwaysdata откройте `Web → Sites → Add a site` и задайте:

- тип: `Node.js`;
- команда: `node /home/ИМЯ-АККАУНТА/comtrade-backend/server.js`;
- рабочая папка: `/home/ИМЯ-АККАУНТА/comtrade-backend`;
- версия Node.js: 22;
- HTTPS: включён.

Добавьте переменные окружения:

```text
MAX_RECORDS=50000
REQUEST_INTERVAL_MS=1100
UPSTREAM_TIMEOUT_MS=180000
MAX_RETRIES=3
ALLOWED_ORIGINS=*
```

Сохраните настройки и перезапустите сайт.

## 4. Проверка backend

Откройте:

```text
https://ИМЯ-АККАУНТА.alwaysdata.net/health
```

Ожидаемый признак успешной настройки:

```json
{"ok":true,"maxRecords":50000}
```

## 5. Подключение GitHub Pages

В корневом `config.js` укажите:

```js
window.COMTRADE_PROXY_URL = "https://ИМЯ-АККАУНТА.alwaysdata.net/api/comtrade";
```

API-ключ UN Comtrade передаётся backend только во время запроса, не сохраняется в статических файлах и не включается в копируемые URL.
