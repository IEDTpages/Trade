# Конструктор запросов UN Comtrade

Статическая версия русскоязычного конструктора запросов и аналитического дашборда UN Comtrade, подготовленная для GitHub Pages.

## 1. Публикация независимого прокси

GitHub Pages является статическим хостингом и не может самостоятельно пересылать запросы к UN Comtrade. Поэтому проект включает небольшой прокси для Cloudflare Workers. Он не использует сервисы, домены или инфраструктуру ChatGPT/OpenAI.

1. Создайте бесплатную учётную запись Cloudflare и откройте **Workers & Pages**.
2. Нажмите **Create → Worker → Deploy**.
3. Откройте созданный Worker, нажмите **Edit code**, замените код содержимым файла `cloudflare-worker/worker.js` и нажмите **Deploy**.
4. Скопируйте адрес Worker вида `https://имя-воркера.ваш-поддомен.workers.dev`.
5. Для дополнительной защиты откройте **Settings → Variables and Secrets**, добавьте переменную `ALLOWED_ORIGINS` и укажите полный адрес GitHub Pages без завершающего `/`, например `https://username.github.io`.

## 2. Публикация на GitHub Pages

1. Создайте пустой репозиторий на GitHub.
2. Загрузите в него всё содержимое этой папки в ветку `main`.
3. Откройте **Settings → Secrets and variables → Actions → Variables**.
4. Создайте переменную `NEXT_PUBLIC_COMTRADE_PROXY_URL` и вставьте адрес Worker с окончанием `/api/comtrade`, например `https://имя-воркера.ваш-поддомен.workers.dev/api/comtrade`.
5. Откройте **Settings → Pages**.
6. В разделе **Build and deployment → Source** выберите **GitHub Actions**.
7. Откройте вкладку **Actions** и дождитесь завершения процесса **Deploy to GitHub Pages**.
8. Адрес опубликованного сайта появится в карточке завершённого процесса и в **Settings → Pages**.

Workflow `.github/workflows/pages.yml` автоматически собирает проект при каждом обновлении ветки `main`. Он поддерживает как пользовательский адрес вида `https://имя.github.io/`, так и адрес проекта `https://имя.github.io/репозиторий/`.

## Локальная проверка

Требуется Node.js 22.

```bash
npm ci
npm run build:pages
npx serve out
```

После сборки готовый статический сайт находится в папке `out`.

## Особенности GitHub Pages

- Запросы выполняются через ваш собственный Cloudflare Worker, поскольку официальный API UN Comtrade блокирует прямые междоменные запросы из GitHub Pages.
- API-ключ не сохраняется приложением или Worker и используется только для текущего запроса.
- Во время работы сайт обращается только к GitHub Pages, вашему Worker и официальному API `comtradeapi.un.org`.
- Если переменная `NEXT_PUBLIC_COMTRADE_PROXY_URL` не задана, интерфейс покажет понятную ошибку вместо неинформативного `Failed to fetch`.
- Очередь крупных запросов выполняется строго последовательно, как и в опубликованной рабочей версии.

## Основные команды

- `npm run build:pages` — статическая сборка для GitHub Pages;
- `npm run lint` — проверка исходного кода;
- `npm run dev` — локальный режим исходного Sites-проекта.
