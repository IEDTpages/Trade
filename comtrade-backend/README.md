# UN Comtrade Proxy

Express-backend для конструктора UN Comtrade.

Он принимает `POST /api/comtrade`, ставит все обращения в общую очередь,
выдерживает интервал 1,1 секунды, повторяет временно неудачные запросы и
передаёт крупные ответы потоком.

## Локальный запуск

```bash
npm ci
npm test
npm start
```

Проверка:

```text
http://localhost:3000/health
```

Рабочий URL:

```text
http://localhost:3000/api/comtrade
```

На alwaysdata приложение использует автоматически заданные переменные `IP` и
`PORT`. Команда запуска:

```text
node /home/ИМЯ-АККАУНТА/comtrade-backend/server.js
```

Оставьте один экземпляр приложения, чтобы очередь запросов была общей.
