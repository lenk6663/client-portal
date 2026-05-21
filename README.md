# Личный кабинет для клиентов компании 
## Требования

* Node.js 20+
* Docker + Docker Compose
* npm

---

## 1. Запуск инфраструктуры

```bash
docker compose up -d
```

Проверка:

```bash
docker compose ps
```

Поднимаются:

* PostgreSQL (internal + external)
* MinIO

---

## 2. Установка зависимостей

```bash
cd backend
npm install
```

---

## 3. Запуск backend

```bash
npm run dev
```

---

## 4. После запуска

API:

```
http://localhost:3000
```

WebSocket:

```
ws://localhost:3000/ws
```
