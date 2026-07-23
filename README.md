# Конструктор запросов UN Comtrade

Готовая бесплатная схема:

```text
GitHub Pages → ваш Node.js-backend на alwaysdata → comtradeapi.un.org
```

Интерфейс и визуализации остаются на GitHub Pages. Backend находится в папке
`comtrade-backend` и работает как обычное постоянное Node.js-приложение на
бессрочном тарифе alwaysdata Free.

## Что реализовано

- до 50 000 строк в одном пакете при наличии API-ключа UN Comtrade;
- одна общая серверная очередь для всех вкладок и пользователей;
- интервал не менее 1,1 секунды между обращениями к UN Comtrade;
- строго последовательное выполнение запросов;
- повторы при `429/502/503/504` с учётом `Retry-After`;
- шестичасовой кэш небольших успешных ответов;
- общий лимит кэша 32 МБ для тарифа с 256 МБ RAM;
- потоковая передача крупных ответов без накопления всего JSON в памяти;
- CORS и корректная обработка `OPTIONS`;
- пятиминутный тайм-аут в интерфейсе вместо бесконечной загрузки;
- API-ключ не записывается в логи и не включается в ключ кэша.

## Состав проекта

| Путь | Назначение |
|---|---|
| `app/` | интерфейс и аналитика GitHub Pages |
| `.github/workflows/pages.yml` | автоматическая публикация интерфейса |
| `.github/workflows/backend-check.yml` | тесты backend |
| `comtrade-backend/` | Express-прокси |
| `deploy/comtrade-backend-alwaysdata.zip` | компактный архив для загрузки на хостинг |
| `DEPLOY_ALWAYSDATA.md` | пошаговая инструкция для Windows |

## Что сделать

1. Замените содержимое текущего GitHub-репозитория файлами из этой сборки.
2. Закоммитьте изменения в ветку `main`.
3. Разверните backend по инструкции
   [DEPLOY_ALWAYSDATA.md](DEPLOY_ALWAYSDATA.md).
4. Проверьте:

   ```text
   https://ИМЯ-АККАУНТА.alwaysdata.net/health
   ```

5. В GitHub создайте или измените переменную:

   ```text
   NEXT_PUBLIC_COMTRADE_PROXY_URL=https://ИМЯ-АККАУНТА.alwaysdata.net/api/comtrade
   ```

6. Повторно запустите workflow `Deploy to GitHub Pages`.
7. Откройте конструктор без VPN и обновите страницу через `Ctrl+F5`.

Не сохраняйте API-ключ UN Comtrade в GitHub или на хостинге. Пользователь вводит
его в конструкторе; ключ передаётся backend только при выполнении текущего
запроса.

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

## Важные условия

- На бесплатном хостинге должен работать один экземпляр backend, чтобы очередь
  и ограничитель частоты оставались общими.
- Бесплатный тариф alwaysdata предназначен для персонального использования.
- Если GitHub Pages открыт по адресу с подпапкой репозитория, в
  `ALLOWED_ORIGINS` всё равно указывается только origin, например
  `https://username.github.io`, без `/repository/`.
