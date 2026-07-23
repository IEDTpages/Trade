# Публикация backend в Timeweb App Platform

Ниже — основной вариант для уже работающего интерфейса на GitHub Pages.

## Шаг 1. Обновить GitHub-репозиторий

1. Распакуйте сборку.
2. Откройте текущий репозиторий конструктора.
3. Замените его содержимое файлами из распакованной папки.
4. Убедитесь, что в корне появились:
   - папка `comtrade-backend`;
   - файл `DEPLOY_TIMEWEB.md`;
   - файл `.github/workflows/backend-check.yml`.
5. Закоммитьте изменения в ветку `main`.

Старую папку `yandex-cloud-function` и архив функции можно удалить: новый
проект их не использует.

## Шаг 2. Создать backend-приложение

1. Войдите в панель Timeweb Cloud.
2. Откройте **App Platform** и нажмите **Создать приложение**.
3. Выберите подключение репозитория через **GitHub**.
4. Разрешите Timeweb доступ к репозиторию конструктора.
5. Выберите:
   - репозиторий — репозиторий конструктора;
   - ветка — `main`;
   - тип приложения — **Backend**;
   - фреймворк — **Express**;
   - среда — **Node.js 22**;
   - путь к директории проекта — `comtrade-backend`.
6. Если панель просит команду сборки, укажите:

   ```text
   npm run build
   ```

7. Если панель просит команду запуска, укажите:

   ```text
   npm start
   ```

8. Оставьте один экземпляр/реплику приложения.

Backend уже слушает `0.0.0.0` и использует порт из системной переменной `PORT`.
Фиксировать собственный порт в панели не требуется.

## Шаг 3. Добавить настройки

В разделе переменных окружения добавьте:

| Переменная | Значение |
|---|---:|
| `MAX_RECORDS` | `50000` |
| `REQUEST_INTERVAL_MS` | `1100` |
| `UPSTREAM_TIMEOUT_MS` | `180000` |
| `MAX_RETRIES` | `3` |
| `CACHE_TTL_MS` | `21600000` |
| `CACHE_MAX_ENTRIES` | `100` |
| `CACHE_MAX_ENTRY_BYTES` | `26214400` |
| `ALLOWED_ORIGINS` | `*` |

Не добавляйте `subscription-key` или API-ключ UN Comtrade в переменные.

Если хотите разрешить только один Pages-домен, вместо `*` можно указать:

```text
https://ИМЯ.github.io
```

Указывайте только origin без пути репозитория. Например, для страницы
`https://iedtpages.github.io/operboard/` origin равен
`https://iedtpages.github.io`.

## Шаг 4. Настроить проверку состояния

Если Timeweb предлагает поле **Путь проверки состояния**, укажите:

```text
/health
```

Запустите развёртывание. После завершения Timeweb выдаст технический HTTPS-домен.

## Шаг 5. Проверить backend

Откройте без VPN:

```text
https://ВАШ-ТЕХНИЧЕСКИЙ-ДОМЕН/health
```

Нормальный ответ:

```json
{
  "ok": true,
  "service": "UN Comtrade proxy",
  "maxRecords": 50000,
  "requestIntervalMs": 1100,
  "queuePending": 0,
  "cacheEntries": 0
}
```

Также проверьте в PowerShell:

```powershell
Invoke-RestMethod "https://ВАШ-ТЕХНИЧЕСКИЙ-ДОМЕН/health"
```

Если адрес не открывается без VPN, не переходите к GitHub Pages: сначала
проверьте журнал запуска Timeweb и правильность пути `comtrade-backend`.

## Шаг 6. Подключить GitHub Pages

1. Откройте репозиторий GitHub.
2. Перейдите в **Settings → Secrets and variables → Actions → Variables**.
3. Создайте или измените переменную:

   ```text
   NEXT_PUBLIC_COMTRADE_PROXY_URL
   ```

4. Значение должно содержать полный путь:

   ```text
   https://ВАШ-ТЕХНИЧЕСКИЙ-ДОМЕН/api/comtrade
   ```

5. Откройте **Actions → Deploy to GitHub Pages**.
6. Нажмите **Run workflow** для ветки `main`.
7. После успешной публикации обновите конструктор через `Ctrl+F5`.

Адрес backend встраивается в JavaScript во время сборки Pages. Простое изменение
GitHub-переменной без повторного запуска workflow не обновит сайт.

## Шаг 7. Контрольный тест

1. Откройте конструктор без VPN.
2. Выберите небольшой годовой запрос.
3. Нажмите **Проверить и разбить**.
4. Убедитесь, что очередь построена.
5. Введите API-ключ и выполните очередь.
6. Проверьте крупный запрос: в интерфейсе должно отображаться ограничение одной
   части `50 000 строк`.

В DevTools браузера запрос должен идти только на технический домен Timeweb.
Обращений к `workers.dev`, `yandexcloud.net`, `chatgpt.site` или `openai.com`
быть не должно.

## Автообновление

При включённом автодеплое Timeweb будет пересобирать backend после изменений в
ветке `main`. GitHub Pages независимо пересобирает интерфейс workflow-файлом
`.github/workflows/pages.yml`.

## Если возникает ошибка

| Симптом | Что проверить |
|---|---|
| `Failed to fetch` | открывается ли `/health` без VPN; полный ли путь `/api/comtrade` в GitHub-переменной |
| CORS | `ALLOWED_ORIGINS=*` либо указан origin без `/repository/` |
| `504` | увеличить `UPSTREAM_TIMEOUT_MS` до `300000` |
| частые `429` | один ли экземпляр backend; не уменьшен ли `REQUEST_INTERVAL_MS` |
| старый лимит 2 000 | повторно ли собран GitHub Pages после замены файлов |
| backend не стартует | путь проекта `comtrade-backend`, Node.js 22, команда `npm start` |

Официальная документация:

- [принципы App Platform](https://timeweb.cloud/docs/apps/how-it-works);
- [развёртывание Express](https://timeweb.cloud/docs/apps/deploying-backend-applications/express).
