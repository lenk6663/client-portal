# Портал клиента «Неосистемы Северо-Запад» — Backend

## Быстрый старт

### 1. Предварительные требования

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (запущен)
- [Node.js 20+](https://nodejs.org/)
- npm 10+

### 2. Запуск баз данных и MinIO

Из корня проекта (`c:\sites\TPPO`):

```powershell
docker-compose up -d
```

Запускает:
| Контейнер | Порт | Назначение |
|---|---|---|
| `tppo-db-internal` | 5432 | Внутренняя PostgreSQL |
| `tppo-db-external` | 5433 | Симуляция 1С (тестовые данные) |
| `tppo-minio` | 9000 / 9001 | Хранилище файлов (S3) |

### 3. Настройка переменных окружения

```powershell
cd backend
copy .env.example .env   # уже готов для dev-режима
```

### 4. Установка зависимостей

```powershell
npm install
```

### 5. Создание бакета в MinIO

Откройте MinIO Console: http://localhost:9001  
Логин: `minioadmin` / пароль: `minioadmin`  
Создайте бакет `tppo-files` (или через mc CLI):

```powershell
docker run --rm --network host minio/mc:latest sh -c "
  mc alias set local http://localhost:9000 minioadmin minioadmin &&
  mc mb local/tppo-files"
```

### 6. Запуск в dev-режиме

```powershell
npm run dev
```

API будет доступно на: http://localhost:3000  
WebSocket: ws://localhost:3000/ws

---

## Структура проекта

```
backend/
├── src/
│   ├── config/
│   │   └── database.ts       # Пулы соединений (внутр. + внешн. БД)
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 001_init.sql  # Схема внутренней БД (14 таблиц)
│   │   └── migrate.ts        # Раннер миграций
│   ├── middleware/
│   │   ├── auth.ts           # JWT requireAuth / requireRole
│   │   └── errorHandler.ts   # Централизованная обработка ошибок
│   ├── routes/
│   │   ├── auth.ts           # POST /auth/login|verify|refresh|logout
│   │   ├── tickets.ts        # CRUD обращений + история + sync-status
│   │   ├── messages.ts       # GET/POST /tickets/:id/messages
│   │   ├── files.ts          # Presigned upload + confirm + download
│   │   ├── users.ts          # Профиль + настройки уведомлений
│   │   └── dictionaries.ts   # Справочники services/departments/statuses
│   ├── services/
│   │   ├── syncService.ts    # Синхронизация с 1С (inbound + outbox)
│   │   └── websocketService.ts # WS subscribe/broadcast по обращениям
│   ├── types/index.ts        # Общие интерфейсы + Express augmentation
│   ├── app.ts                # Express app factory
│   └── index.ts              # Entrypoint
├── docker/
│   └── init-external.sql     # Инициализация внешней БД (исправленный)
├── .env                      # Переменные окружения (dev)
├── .env.example              # Шаблон
├── Dockerfile                # Multi-stage production build
├── package.json
└── tsconfig.json
```

---

## API Endpoints

### Авторизация
| Метод | URL | Описание |
|---|---|---|
| POST | `/api/auth/login` | Запросить OTP-код (в dev: возвращается в ответе) |
| POST | `/api/auth/verify` | Подтвердить OTP → access + refresh токены |
| POST | `/api/auth/refresh` | Обновить access token |
| POST | `/api/auth/logout` | Отозвать refresh token |

### Обращения
| Метод | URL | Описание |
|---|---|---|
| GET | `/api/tickets` | Список (фильтры: status, type, urgency, page, limit) |
| POST | `/api/tickets` | Создать обращение |
| GET | `/api/tickets/:id` | Детали обращения |
| PUT | `/api/tickets/:id` | Обновить (optimistic locking по version) |
| GET | `/api/tickets/:id/history` | История изменений |
| GET | `/api/tickets/:id/sync-status` | Статус синхронизации с 1С |

### Сообщения
| Метод | URL | Описание |
|---|---|---|
| GET | `/api/tickets/:id/messages` | Все сообщения |
| POST | `/api/tickets/:id/messages` | Отправить сообщение (идемпотентно) |

### Файлы
| Метод | URL | Описание |
|---|---|---|
| POST | `/api/files/upload-request` | Получить presigned PUT URL |
| POST | `/api/files/confirm` | Подтвердить загрузку |
| GET | `/api/files/:id/download-url` | Получить presigned GET URL |
| GET | `/api/files/:id/metadata` | Метаданные файла |

### Профиль
| Метод | URL | Описание |
|---|---|---|
| GET | `/api/users/profile` | Профиль текущего пользователя |
| PUT | `/api/users/profile` | Обновить имя/email |
| GET | `/api/users/notification-settings` | Настройки уведомлений |
| PUT | `/api/users/notification-settings` | Обновить настройки |

### Справочники (публичные)
| Метод | URL | Описание |
|---|---|---|
| GET | `/api/dictionaries/services` | Список услуг |
| GET | `/api/dictionaries/departments` | Список отделов |
| GET | `/api/dictionaries/statuses` | Список статусов |

### WebSocket `/ws`
```json
// Авторизация
{"type": "auth", "token": "<access_token>"}
// Подписка на обращение
{"type": "subscribe", "ticket_id": "<uuid>"}
// Входящие события:
// ticket.updated, ticket.sync, message.new
```

---

## Синхронизация с 1С

- **Входящая (каждые 30 сек)** — читает `неоОбращенияКлиента` из внешней БД, обновляет внутренние `tickets`
- **Исходящая Outbox (каждые 5 сек)** — обрабатывает события `outbox`, пишет в внешнюю БД  
- Маппинг статусов: `Создано→new`, `В работе→in_progress`, `На согласовании→on_approval` и т.д.
- Конфликты версий сохраняются в таблицу `conflicts`

---

## Демо-аккаунт

| Поле | Значение |
|---|---|
| Телефон | +79991234567 |
| SMS-код (dev) | Возвращается в `/api/auth/login` ответе |
