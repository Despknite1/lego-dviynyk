# Структура проєкту LEGO-Двійник

Короткий путівник для власника сайту: що де лежить і що можна міняти.

## Дерево папок

```
lego-site/
├── server.js          — головний файл сервера: всі адреси /api/... і роздача сторінок
├── package.json       — список бібліотек і команди (npm start, npm test)
├── Dockerfile         — як зібрати сайт для хостингу
├── .env.example       — ПРИКЛАД змінних середовища (без справжніх значень)
├── .github/workflows/ — автодеплой: пуш у main → сайт оновлюється
├── lib/               — «мозок» сервера, розбитий на модулі
│   ├── minifig.js     — малює фігурку (SVG/PNG) і принти для 3D
│   ├── rules.js       — правила-виправлення кольорів/одягу після ШІ
│   ├── identify.js    — впізнавання персонажа (Gemini + Google Search) і правила кольору тіла/матеріалу/реквізиту
│   ├── regen.js       — логіка «Згенерувати ще раз»
│   ├── facesafe.js    — підбір і «чистка» облич
│   ├── faceoptions.js — варіанти облич для панелі вибору
│   ├── locks.js       — «замочки» частин фігурки
│   ├── ldpack.js      — пакує 3D-деталі LDraw для переглядача
│   ├── my/            — «Мої фігурки» (база, анонімний cookie, API)
│   └── sec/           — безпека: акаунти, шифрування, перевірка фото, ліміти, логи, пошта
├── public/            — ВСЕ, що бачить відвідувач у браузері
│   ├── index.html     — головна сторінка (стилі + розмітка + скрипт в одному файлі)
│   ├── viewer3d.html  — сторінка 3D-переглядача (в iframe)
│   ├── viewer3d.js    — 3D-модель на three.js
│   ├── face_picker.js / .css — панель «Найпохожіші обличчя»
│   ├── my_figures.js  — розділ «Мої фігурки»
│   ├── account.js     — вхід/реєстрація
│   ├── heads_lib.js   — геометрія голів для 3D
│   └── heads_thumb.html — службова сторінка мініатюр голів
├── faces/             — каталог голів LEGO (дані, не код)
├── ldraw/             — 3D-креслення деталей LEGO (дані, не код)
├── tests/             — автоматичні перевірки (npm test)
└── docs/              — документація (цей файл)
```

## Як проходить запит (фото → фігурка)

1. **Фото.** Відвідувач завантажує фото на `index.html` → браузер шле його на `/api/detect`. Сервер перевіряє файл (`lib/sec/upload.js`) і просить ШІ знайти людей. На фото з'являються рамки.
2. **Опис.** Клік по людині → `/api/describe` — ШІ описує волосся, одяг, аксесуари.
3. **Пошук.** `/api/search` шукає схожі справжні мініфігурки на Brickset і показує картки.
4. **Генерація.** `/api/generate` створює «специфікацію» власної фігурки, сервер виправляє її правилами (`lib/rules.js`, `lib/facesafe.js`), малює (`lib/minifig.js`) і зберігає версію (`lib/my/`).
5. **3D.** `viewer3d.html` + `viewer3d.js` будують 3D-модель. Кнопка «Згенерувати ще раз» знову йде в `/api/generate` (логіка — `lib/regen.js`), «замочки» тримають вибрані частини.

Довгі операції працюють як «завдання»: сторінка опитує `/job/<id>`, поки не буде готово.

## Де міняти вигляд, а де поведінку

| Хочу змінити… | Де |
|---|---|
| Кольори всього сайту | `public/index.html`, блок `:root{...}` (позначено коментарем «КОЛЬОРИ ТА ТЕМА») |
| Кнопки, шапку, картки, мобільну версію | `public/index.html`, секція `<style>` — позначено коментарями |
| Тексти на сторінці | `public/index.html`, HTML-розмітка після `<body>` |
| Вигляд 3D-переглядача | `public/viewer3d.html` (`<style>`) |
| Панель облич | `public/face_picker.css` |
| Що відбувається при натисканні | JavaScript: `<script>` в `index.html`, `public/*.js` |
| Логіка сервера, ШІ, пошук | `server.js`, `lib/` |

Порада: CSS/HTML міняти безпечно — найгірше, що станеться, «поїде» вигляд. Зміни в JS/сервері перевіряйте командою `npm test`.

## Запуск на своєму комп'ютері

```
npm install
npm start          # сайт на http://localhost:3000 (або порт зі змінної PORT)
npm test           # автоматичні перевірки
```

Змінні середовища (значення беріть у власника/хостингу, НЕ пишіть їх у код):
скопіюйте `.env.example` у `.env` і заповніть. Основні назви:
`GEMINI_API_KEY`, `GEMINI_BASE_URL`, `HORDE_API_KEY`, `PORT`, `DATABASE_URL`, `SQLITE_PATH`, `ALLOW_SQLITE`,
`FIGURES_ENABLED`, `ACCOUNTS_ENABLED`, `PII_ENC_KEY`, `PII_INDEX_KEY`, `MAIL_PROVIDER`, `MAIL_FROM`, `RESEND_API_KEY`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `LDRAW_DIR`, `UPLOAD_DIR`, `LOG_LEVEL`, `NODE_ENV`,
а також тонкі налаштування (`TEXT_MODELS`, `SPEC_MODELS`, `IMG_MODELS`, `GEM_PARALLEL`, `RATE_PER_IP`, ...).

## ⚠️ Важливо: секрети та дані користувачів

- **Ніколи** не додавайте в репозиторій файл `.env`, ключі API, паролі, ключі шифрування.
- **Ніколи** не комітьте фото відвідувачів, папки `data/`, `out/`, бази `*.sqlite`, логи.
- Усе це вже в `.gitignore`, але перед комітом дивіться, які файли додаються.
- Пуш у гілку `main` одразу оновлює живий сайт.

## Сервіси, які використовує проєкт

> Тут лише **назви** змінних середовища — значення (ключі, паролі) ніколи не пишемо в репозиторій. Їх задають у Render → Environment або в GitHub → Settings → Secrets.

### Активні (працюють зараз)

| Сервіс | Що робить для сайту | Де в коді / конфігу | Змінні середовища (назви) | Панель керування |
|---|---|---|---|---|
| **GitHub** (репо `Despknite1/lego-dviynyk`) | Зберігає код, історію змін | весь репозиторій | — | https://github.com/Despknite1/lego-dviynyk |
| **GitHub Actions** | Збирає Docker-образ при push у `main`, щотижня перебудовує, запускає деплой на Render | `.github/workflows/deploy.yml` | секрет `RENDER_DEPLOY_HOOK`; `GITHUB_TOKEN` (автоматичний) | https://github.com/Despknite1/lego-dviynyk/actions |
| **GHCR** (GitHub Container Registry) | Зберігає готові Docker-образи `ghcr.io/despknite1/lego-dviynyk` | `.github/workflows/deploy.yml`, `Dockerfile` | `GITHUB_TOKEN` | https://github.com/Despknite1?tab=packages |
| **Render** | Хостинг сайту (Docker, план free), сервіс у «Pavlo's workspace», адреса https://lego-dviynyk.onrender.com | `render.yaml`, `Dockerfile` (`/healthz`) | `NODE_ENV`, `PORT`, `TRUST_PROXY_HOPS` + усі змінні нижче | https://dashboard.render.com |
| **Neon Postgres** | База даних: історія фігурок, акаунти (коли увімкнені) | `server.js`, `lib/` (пакет `pg`) | `DATABASE_URL` (запасний локальний варіант: `ALLOW_SQLITE`, `SQLITE_PATH`) | https://console.neon.tech |
| **Google Gemini API** (`generativelanguage.googleapis.com`) | ШІ: опис фото, специфікація фігурки, перевірка результату, впізнавання персонажа | `server.js`, `tests/gem_errors.test.js` | `GEMINI_API_KEY`, `GEMINI_BASE_URL`, `TEXT_MODELS`, `SPEC_MODELS`, `IMG_MODELS`, `EXTRA_MODELS`, `GEM_PARALLEL` | https://aistudio.google.com/apikey |
| **Brickset** (`brickset.com`, `images.brickset.com`) | Пошук схожих офіційних мініфігурок і наборів, ціни (на основі BrickLink) | `server.js` (`bricksetSearch`), `public/index.html` | — (публічні сторінки) | https://brickset.com |
| **BrickLink** (`img.bricklink.com`, `www.bricklink.com`) | Картинки мініфігурок; посилання «купити» на фігурки, набори й деталі | `server.js`, `public/viewer3d.js` | — | https://www.bricklink.com |
| **BrickEconomy, Rebrickable, LEGO.com** | Лише посилання з картки результату (сервер їх не викликає) | `server.js` (поле `links`) | — | https://www.brickeconomy.com · https://rebrickable.com · https://www.lego.com |
| **Wikipedia API** (`en.wikipedia.org/w/api.php`) | Референс-фото відомого персонажа для порівняння | `server.js` | — | https://en.wikipedia.org |
| **AI Horde** (`aihorde.net`) | Резервна генерація зображень (безкоштовна спільнотна мережа) | `server.js` (`/api/v2/generate/...`) | `HORDE_API_KEY` | https://aihorde.net |
| **LDraw parts library** | 3D-моделі деталей LEGO; копія лежить у папці `ldraw/` (вкладена в образ) | `ldraw/`, `Dockerfile`, `public/viewer3d.js`, `mkspec3d.js` | `LDRAW_DIR` | https://library.ldraw.org |
| **three.js** (npm `three@0.170.0`) | 3D-перегляд фігурки в браузері (`LDrawLoader`); віддається з власного сервера `/vendor/three/` | `package.json`, `public/viewer3d.js`, `public/*.html` | — | https://threejs.org |
| **npm registry** | Встановлення залежностей під час збірки | `package.json`, `package-lock.json`, `Dockerfile` | — | https://www.npmjs.com |
| **Docker Hub** (базовий образ `node:20-bookworm-slim`) | Основа контейнера | `Dockerfile` | — | https://hub.docker.com/_/node |

### Заплановані / підготовлені, але ще не використовуються

| Сервіс | Навіщо | Де в коді / конфігу | Змінні середовища (назви) | Панель керування |
|---|---|---|---|---|
| **Resend** (email API) | Листи для скидання пароля / підтвердження, коли увімкнуться акаунти (`ACCOUNTS_ENABLED=false` зараз) | `lib/sec/mailer.js`, `.env.example`, `render.yaml` | `MAIL_PROVIDER=resend`, `MAIL_FROM`, `RESEND_API_KEY` | https://resend.com/overview |
| **SMTP-поштовий сервер** (альтернатива Resend) | Те саме, через `nodemailer` | `lib/sec/mailer.js`, `.env.example` | `MAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | залежить від провайдера |
| **SMS-провайдер** | Згаданий у `mailer.js` як `SMS_PROVIDER=stub` — не реалізований | `lib/sec/mailer.js` | `SMS_PROVIDER` | — |

Пов'язані з акаунтами ключі шифрування (не зовнішній сервіс, але секрети): `PII_ENC_KEY`, `PII_INDEX_KEY` — задаються в Render.
