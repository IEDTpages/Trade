# Конструктор запросов UN Comtrade

Готовая схема для работы из России без Cloudflare Workers, Yandex Cloud
Functions, ChatGPT и OpenAI:

```text
GitHub Pages → ваш Express-backend в Timeweb → comtradeapi.un.org
```

Интерфейс и визуализации остаются на GitHub Pages. Постоянно работающий
backend расположен в папке `comtrade-backend` и разворачивается из того же
GitHub-репозитория в Timeweb App Platform.

## Что решено

- пакет одного запроса увеличен с 2 000 до 50 000 строк;
- отсутствует ограничение Yandex Cloud Functions на размер JSON-ответа;
- все обращения к UN Comtrade проходят через одну общую серверную очередь;
- между началами запросов выдерживается не менее 1,1 секунды;
- обращения выполняются строго последовательно, даже если конструктор открыт в
  нескольких вкладках;
- при `429/502/503/504` backend учитывает `Retry-After` и повторяет запрос;
- небольшие успешные ответы кэшируются на 6 часов;
- большие ответы передаются потоком, не накапливаясь целиком в памяти backend;
- API-ключ не записывается в логи и не попадает в ключ кэша;
- CORS и `OPTIONS` поддерживаются;
- у клиента есть конечный тайм-аут 5 минут вместо бесконечной обработки.

## Состав проекта

| Путь | Назначение |
|---|---|
| `app/` | интерфейс и аналитика GitHub Pages |
| `.github/workflows/pages.yml` | публикация интерфейса |
| `.github/workflows/backend-check.yml` | автоматические тесты backend |
| `comtrade-backend/` | Express-прокси для Timeweb |
| `DEPLOY_TIMEWEB.md` | основная пошаговая инструкция |
| `DEPLOY_VPS.md` | резервный вариант для собственного VPS |
| `docker-compose.yml`, `Caddyfile` | HTTPS-развёртывание на VPS |

## Рекомендуемый порядок

1. Замените содержимое текущего GitHub-репозитория файлами из этой сборки.
2. Закоммитьте изменения в ветку `main`.
3. Разверните папку `comtrade-backend` в Timeweb по
   [пошаговой инструкции](DEPLOY_TIMEWEB.md).
4. Проверьте адрес `https://ваш-домен/health`.
5. В GitHub задайте переменную:

   ```text
   NEXT_PUBLIC_COMTRADE_PROXY_URL=https://ваш-домен/api/comtrade
   ```

6. Повторно запустите workflow `Deploy to GitHub Pages`.
7. Откройте конструктор без VPN и обновите страницу через `Ctrl+F5`.

Не сохраняйте API-ключ UN Comtrade в GitHub Secrets или в Timeweb. Пользователь
вводит его в конструкторе, после чего ключ передаётся backend только для
текущего запроса.

## Локальная проверка

Требуется Node.js 22.

```bash
npm ci
npm --prefix comtrade-backend ci
npm test
npm run build:pages
```

Запуск backend:

```bash
npm --prefix comtrade-backend start
```

Проверка:

```text
http://localhost:3000/health
```

Для локального запуска интерфейса создайте `.env.local`:

```text
NEXT_PUBLIC_COMTRADE_PROXY_URL=http://localhost:3000/api/comtrade
```

Затем выполните `npm run dev`.

## Важное условие

Для общей очереди в Timeweb должен работать **один экземпляр** backend. Если
включить несколько реплик, каждая получит собственную очередь и суммарная
частота запросов к UN Comtrade станет выше заданной.
