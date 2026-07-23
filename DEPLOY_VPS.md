# Резервный вариант: собственный VPS

Этот вариант нужен, если Timeweb App Platform окажется недоступен или потребуется
полный контроль над сервером. В сборке уже есть `docker-compose.yml` и
`Caddyfile`; Caddy автоматически получает HTTPS-сертификат.

## Требования

- VPS с публичным IPv4;
- Ubuntu 22.04/24.04 или другой Linux с Docker Compose;
- домен или поддомен, например `comtrade-api.example.ru`;
- DNS-запись `A`, направленная на IPv4 VPS;
- открытые входящие порты `80` и `443`.

GitHub Pages работает по HTTPS, поэтому backend на VPS также обязан использовать
HTTPS. Обычный адрес `http://IP:3000` браузер заблокирует как mixed content.

## Шаг 1. Установить Docker

Установите Docker Engine и плагин Docker Compose по инструкции вашей ОС. Затем
проверьте:

```bash
docker --version
docker compose version
```

## Шаг 2. Скопировать проект

На сервере клонируйте репозиторий и перейдите в его корень:

```bash
git clone https://github.com/ИМЯ/РЕПОЗИТОРИЙ.git
cd РЕПОЗИТОРИЙ
```

## Шаг 3. Задать домен

Создайте файл `.env` в корне репозитория:

```text
PROXY_DOMAIN=comtrade-api.example.ru
```

DNS-запись домена должна уже указывать на VPS.

## Шаг 4. Запустить

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

Проверьте:

```text
https://comtrade-api.example.ru/health
```

## Шаг 5. Подключить Pages

В GitHub-переменной `NEXT_PUBLIC_COMTRADE_PROXY_URL` укажите:

```text
https://comtrade-api.example.ru/api/comtrade
```

После этого повторно запустите workflow `Deploy to GitHub Pages`.

## Обновление

```bash
git pull
docker compose up -d --build
```

## Диагностика

```bash
docker compose ps
docker compose logs --tail=200 backend
docker compose logs --tail=200 caddy
```

В `docker-compose.yml` работает ровно один контейнер backend, поэтому общая
очередь и интервал 1,1 секунды сохраняются для всех пользователей.
