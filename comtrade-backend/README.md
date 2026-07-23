# UN Comtrade Proxy

Постоянно работающий Express-backend для конструктора UN Comtrade.

Он:

- принимает `POST /api/comtrade`;
- помещает обращения в общую очередь;
- запускает не более одного запроса к UN Comtrade за 1,1 секунды;
- выполняет пакеты строго последовательно;
- повторяет `429/502/503/504` с учётом `Retry-After`;
- поддерживает ответы до 50 000 строк без лимита Cloud Functions;
- кэширует небольшие успешные ответы в памяти;
- не записывает API-ключ в логи или кэш;
- отвечает на `GET /health` и preflight `OPTIONS`.

## Локальный запуск

```bash
npm ci
npm test
npm start
```

Проверка:

```bash
curl http://localhost:3000/health
```

Рабочий URL для клиента:

```text
http://localhost:3000/api/comtrade
```

В production используйте HTTPS-домен Timeweb App Platform или reverse proxy с
TLS. Для единой глобальной очереди оставьте один экземпляр приложения.
