# Личный кабинет для клиентов компании

## Требования

* Docker + Docker Compose
* Node.js 20+ для разработки

---

## Быстрый запуск (Docker)

1. **Очистка старых контейнеров и запуск**

```bash
docker compose down -v
docker compose up --build -d
```

2. **Открыть в браузере**

```
http://localhost:8080
```

---

## Проверка статуса

```bash
docker compose ps
```

Убедитесь, что все сервисы в статусе `Running` или `Exited` (для миграций допустимо).

---

## Остановка

```bash
docker compose down
```

Полная очистка (включая тома с данными):

```bash
docker compose down -v
```

---

## Что поднимается

- **PostgreSQL** (internal + external)
- **MinIO** (объектное хранилище)
- **Backend API** (Node.js)
- **Frontend** (Nginx)
- **Миграции БД** (запускаются один раз)

---

## Доступ к сервисам

- Веб-интерфейс: `http://localhost:8080`
- Backend API: `http://localhost:3000` (внутри контейнера)
- WebSocket: `ws://localhost:3000/ws`
- MinIO Console: `http://localhost:9001`

---

## Логи

Просмотр логов всех сервисов:

```bash
docker compose logs -f
```

Логи конкретного сервиса:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```