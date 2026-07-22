# Независимый прокси UN Comtrade

Разверните `worker.js` в Cloudflare Workers и укажите полученный адрес в переменной GitHub Actions `NEXT_PUBLIC_COMTRADE_PROXY_URL`, добавив путь `/api/comtrade`.

Опциональная переменная Worker `ALLOWED_ORIGINS` содержит разрешённые источники через запятую. Пример: `https://username.github.io,https://example.ru`.
