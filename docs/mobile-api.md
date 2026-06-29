# KidsControlPC — API Reference для мобильного приложения

## Архитектура

Мобильное приложение общается с бэкендом напрямую через **Firebase SDK** — без промежуточного REST API. Данные хранятся в Firestore, файлы в Firebase Storage, бизнес-логика вызывается через Callable Cloud Functions.

```
Mobile App
    ├── Firebase Auth       — аутентификация (email/password)
    ├── Firestore           — данные (real-time подписки + разовые запросы)
    ├── Cloud Functions     — операции с проверкой прав (команды, паринг, инвайты)
    └── Firebase Storage    — скриншоты и вложения чата
```

**Проект:** `kidscontrolpc`  
**Region (Functions):** `us-central1`  
**Storage bucket:** `kidscontrolpc.appspot.com`

---

## SDK и настройка

### React Native / Expo
```bash
# Основной пакет
npm install @react-native-firebase/app

# По фичам
npm install @react-native-firebase/auth
npm install @react-native-firebase/firestore
npm install @react-native-firebase/functions
npm install @react-native-firebase/storage
```

### Flutter
```yaml
dependencies:
  firebase_core: ...
  firebase_auth: ...
  cloud_firestore: ...
  cloud_functions: ...
  firebase_storage: ...
```

### Конфигурация
Скачать `google-services.json` (Android) и `GoogleService-Info.plist` (iOS) из Firebase Console → Project Settings → Your apps.

---

## Аутентификация

### Роли

| Роль | Описание |
|------|----------|
| `owner` | Первичный родитель. Регистрируется самостоятельно. Владеет всеми данными. |
| `parent` | Вторичный родитель. Приглашается owner по email. Имеет те же права на устройства. |

Оба используют **email/password** через Firebase Auth. Различие видно в `profile.role`.

### Вход / Регистрация

```js
// Вход
const userCredential = await signInWithEmailAndPassword(auth, email, password)
const user = userCredential.user  // { uid, email, ... }

// Регистрация (только для новых owner)
const userCredential = await createUserWithEmailAndPassword(auth, email, password)
// После регистрации вызвать initUserProfile (см. профиль)
```

### Определение ownerUid

Вторичный родитель имеет в профиле `ownerUid` другого пользователя. Для запросов к Firestore всегда нужен `ownerUid` (не `uid` текущего пользователя).

```js
// После входа прочитать профиль:
const profile = await getDoc(doc(db, 'users', user.uid, 'profile', 'data'))
const ownerUid = profile.data().ownerUid  // для owner равен его uid
```

---

## Модель данных Firestore

### Структура коллекций

```
users/{ownerUid}
    profile/data                    — профиль, план, квота хранилища
    parentAccess/{parentUid}        — вторичные родители с доступом
    parentInvitations/{id}          — история приглашений
    alerts/{alertId}                — уведомления от агентов
    chats/{chatId}                  — чаты с детьми
        messages/{msgId}
    devices/{deviceId}              — подключённые детские ПК
        rules/{ruleId}              — правила блокировки
        commands/{commandId}        — команды для агента
        installedApps/{appId}       — установленные программы
        screenshots/{screenshotId}  — скриншоты
        activityLogs/{logId}        — события активности
        activityStats/{YYYY-MM-DD}  — агрегированная статистика по дням
```

---

### `users/{ownerUid}/profile/data`

| Поле | Тип | Описание |
|------|-----|----------|
| `email` | string | Email пользователя |
| `role` | `'owner'` \| `'parent'` | Роль в системе |
| `ownerUid` | string | UID первичного родителя (для owner = его uid) |
| `plan` | `'free'` | Тарифный план |
| `storageUsedBytes` | number | Использовано хранилища (байт) |
| `storageQuotaBytes` | number | Квота хранилища (default: 104857600 = 100 МБ) |
| `chatName` | string? | Имя родителя для отображения детям в чате (напр. "Папа") |
| `createdAt` | Timestamp | Дата регистрации |

---

### `users/{ownerUid}/devices/{deviceId}`

| Поле | Тип | Описание |
|------|-----|----------|
| `deviceName` | string | Имя устройства (hostname по умолчанию) |
| `alias` | string? | Псевдоним, заданный родителем |
| `hostname` | string | Сетевое имя ПК |
| `osType` | string | Тип ОС (`'windows'`) |
| `status` | `'online'` \| `'offline'` | Статус подключения агента |
| `agentVersion` | string | Версия агента (напр. `"1.1.91"`) |
| `pairedAt` | Timestamp | Дата сопряжения |
| `lastSeen` | Timestamp | Последний heartbeat от агента |
| `agentUid` | string | UID анонимной сессии агента (внутреннее поле) |
| `screenshotUploadToken` | string | Токен для загрузки скриншотов (внутреннее, не читается клиентом) |

---

### `users/{ownerUid}/devices/{deviceId}/rules/{ruleId}`

Правило блокировки. Тип определяется полем `type`.

**Общие поля:**

| Поле | Тип | Описание |
|------|-----|----------|
| `type` | string | Тип правила (см. ниже) |
| `status` | `'active'` \| `'inactive'` | Состояние |
| `mode` | string | Режим действия (см. ниже) |
| `createdAt` | Timestamp | |
| `updatedAt` | Timestamp | |

**Типы правил (`type`):**

| Значение | Описание |
|----------|----------|
| `'program'` | Блокировка приложения. Поле `program.name: string` |
| `'web'` | Блокировка сайта. Поле `web.resolvedPattern: string` |
| `'pomodoro'` | Помодоро-режим. Поле `targets: { programs: string[], websites: string[] }` |
| `'profile_config'` | Конфигурация устройства (агент читает, не блокировка) |

**Режимы (`mode`):**

| Значение | Описание |
|----------|----------|
| `'permanent'` | Всегда активно |
| `'schedule'` | По расписанию. Поле `schedule: { ... }` |
| `'timer'` | На заданное время. Поле `timer: { startedAt: Timestamp, duration: number (минуты) }` |
| `'date'` | На конкретную дату/время. Поле `date: { date, timeFrom, timeTo, action }` |
| `'profile'` | По профилю расписания |

---

### `users/{ownerUid}/devices/{deviceId}/commands/{commandId}`

Команда, отправленная родителем агенту. Создаётся только через CF `sendDeviceCommand`.

| Поле | Тип | Описание |
|------|-----|----------|
| `action` | string | Тип команды (см. список ниже) |
| `status` | `'pending'` \| `'completed'` \| `'failed'` | Состояние выполнения |
| `timestamp` | Timestamp | Время создания |
| `message` | string? | Текст (для команды `lock`) |
| `appId` | string? | ID приложения (для блокировки конкретного приложения) |
| `requestedAtClientMs` | number? | Клиентское время запроса (для измерения latency) |

**Доступные действия (`action`):**

| Значение | Описание |
|----------|----------|
| `'lock'` | Заблокировать экран |
| `'unlock'` | Разблокировать экран |
| `'screenshot_request'` | Сделать скриншот |
| `'fetch_logs'` | Запросить логи |
| `'shutdown'` | Выключить ПК |
| `'restart'` | Перезагрузить ПК |
| `'sleep'` | Режим сна |
| `'hibernate'` | Гибернация |
| `'update_agent'` | Обновить агент |
| `'force_update'` | Принудительное обновление агента |
| `'uninstall'` | Удалить агент |

---

### `users/{ownerUid}/devices/{deviceId}/installedApps/{appId}`

Список программ, установленных на детском ПК. Агент обновляет автоматически.

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | string | Отображаемое название |
| `path` | string | Путь к исполняемому файлу |
| `publisher` | string | Издатель |
| `version` | string | Версия |

---

### `users/{ownerUid}/devices/{deviceId}/screenshots/{screenshotId}`

| Поле | Тип | Описание |
|------|-----|----------|
| `storagePath` | string | Путь в Firebase Storage (полное изображение) |
| `thumbnailStoragePath` | string? | Путь к миниатюре |
| `createdAt` | Timestamp | Время создания |
| `downloadedAt` | Timestamp? | Время первого просмотра |

---

### `users/{ownerUid}/devices/{deviceId}/activityLogs/{logId}`

События активности на детском ПК. Агент пишет в реальном времени.

| Поле | Тип | Описание |
|------|-----|----------|
| `type` | string | Тип события (см. ниже) |
| `ts` | Timestamp | Время события |
| `name` | string | Название приложения или домена |
| `detail` | string | Доп. информация (путь к файлу и т.п.) |
| `duration` | number? | Длительность сессии в секундах (только для `app_close`) |

**Типы событий (`type`):**

| Значение | Описание |
|----------|----------|
| `'app_launch'` | Приложение запущено |
| `'app_close'` | Приложение закрыто (содержит `duration`) |
| `'site_blocked'` | Сайт заблокирован (поле `name` = домен) |

---

### `users/{ownerUid}/devices/{deviceId}/activityStats/{date}`

Агрегированная статистика за день. Ключ документа — дата в формате `YYYY-MM-DD`.

| Поле | Тип | Описание |
|------|-----|----------|
| `date` | string | Дата (`YYYY-MM-DD`) |
| `screenTimeSec` | number | Общее экранное время в секундах |
| `appsUsage` | `{ [appBaseName]: number }` | Время использования каждого приложения (сек) |
| `sitesBlocked` | `{ [domain]: number }` | Количество блокировок по доменам |

---

### `users/{ownerUid}/alerts/{alertId}`

| Поле | Тип | Описание |
|------|-----|----------|
| `timestamp` | Timestamp | Время события |
| `acknowledged` | boolean | Прочитано ли |
| (прочие поля) | varies | Зависит от типа события агента |

---

### `users/{ownerUid}/chats/{chatId}`

| Поле | Тип | Описание |
|------|-----|----------|
| `type` | string | Тип чата |
| `name` | string | Название чата |
| `ownerUid` | string | UID владельца |
| `createdBy` | string | UID создателя |
| `deviceIds` | string[] | Устройства-участники |
| `parentUids` | string[] | Родители-участники |
| `lastMessage` | `{ text, senderName, timestamp }` \| null | Последнее сообщение |
| `createdAt` | Timestamp | |
| `updatedAt` | Timestamp | |

### `users/{ownerUid}/chats/{chatId}/messages/{msgId}`

| Поле | Тип | Описание |
|------|-----|----------|
| `text` | string | Текст сообщения |
| `senderType` | `'parent'` \| `'child'` | Кто отправил |
| `senderUid` | string? | UID отправителя-родителя |
| `senderDeviceId` | string? | deviceId отправителя-ребёнка |
| `senderName` | string | Отображаемое имя |
| `timestamp` | Timestamp | |
| `readBy` | string[] | deviceId'ы / UID'ы прочитавших |
| `deliveredTo` | string[] | deviceId'ы / UID'ы доставлено |
| `gifUrl` | string? | URL GIF |
| `gifPreviewUrl` | string? | |
| `fileUrl` | string? | Публичный URL файла |
| `fileName` | string? | |
| `fileSize` | number? | Байт |
| `mimeType` | string? | |
| `storagePath` | string? | Путь в Storage (если файл загружен через Storage) |
| `fileDeleted` | boolean | Файл удалён из Storage |

---

### `users/{ownerUid}/parentAccess/{parentUid}`

Запись о вторичном родителе с активным доступом.

| Поле | Тип | Описание |
|------|-----|----------|
| `email` | string | Email вторичного родителя |
| `role` | `'parent'` | |
| `status` | `'active'` | |
| `ownerUid` | string | UID первичного родителя |
| `acceptedAt` | Timestamp | Дата принятия приглашения |
| `invitedByUid` | string | Кто пригласил |

---

### `users/{ownerUid}/parentInvitations/{invitationId}`

| Поле | Тип | Описание |
|------|-----|----------|
| `email` | string | Email приглашённого |
| `ownerEmail` | string | Email owner'а |
| `status` | `'pending'` \| `'accepted'` \| `'declined'` | |
| `accountCreated` | boolean | Создан ли временный аккаунт |
| `createdAt` | Timestamp | |
| `expiresAt` | Timestamp | Истекает через 24 часа |
| `acceptedAt` | Timestamp? | |

---

## Callable Cloud Functions

Все функции вызываются через Firebase SDK. Требуют аутентифицированного пользователя, если не указано иное.

**Endpoint:** `us-central1`

```js
// React Native Firebase
const fn = firebase.functions().httpsCallable('functionName')
const result = await fn(payload)
const data = result.data

// Web / Expo SDK
import { getFunctions, httpsCallable } from 'firebase/functions'
const fn = httpsCallable(functions, 'functionName')
const result = await fn(payload)
```

---

### `createPairingCode`

Генерирует 6-значный код для сопряжения детского ПК. Код действует 15 минут.

**Auth:** требуется (owner или parent)  
**Payload:** нет

**Response:**
```json
{
  "code": "A3K8NP",
  "expiresAt": "2025-01-01T12:15:00.000Z"
}
```

**Ошибки:**

| Код | Описание |
|-----|----------|
| `unauthenticated` | Пользователь не авторизован |

---

### `sendDeviceCommand`

Отправляет команду на детский ПК. Функция проверяет права доступа и добавляет внутренний токен.

**Auth:** требуется  
**Payload:**

| Поле | Тип | Обяз. | Описание |
|------|-----|-------|----------|
| `ownerUid` | string | нет | UID owner'а (нужен если caller — вторичный parent) |
| `deviceId` | string | да | ID устройства |
| `action` | string | да | Команда (из списка выше) |
| `message` | string | нет | Текст (для `lock`) |
| `appId` | string | нет | ID приложения |
| `requestedAtClientMs` | number | нет | Клиентский timestamp |

**Response:**
```json
{ "commandId": "abc123" }
```

**Ошибки:**

| Код | Описание |
|-----|----------|
| `unauthenticated` | Не авторизован |
| `invalid-argument` | Нет `deviceId` или `action`, или неизвестное действие |
| `permission-denied` | Нет доступа к устройству |
| `not-found` | Устройство не найдено |
| `failed-precondition` | Устройство ещё не готово (нет upload token) |

---

### `createParentInvitation`

Приглашает вторичного родителя по email. Отправляет письмо со ссылкой.  
Может быть вызвана только `owner` (первичным родителем).

**Auth:** требуется (только owner)  
**Payload:**

| Поле | Тип | Описание |
|------|-----|----------|
| `email` | string | Email приглашаемого |

**Response:**
```json
{
  "invitationId": "...",
  "email": "parent@example.com",
  "accountCreated": true,
  "expiresAt": "2025-01-02T12:00:00.000Z"
}
```

**Ошибки:**

| Код | Описание |
|-----|----------|
| `invalid-argument` | Некорректный email или попытка пригласить себя |
| `permission-denied` | Caller — вторичный parent, а не owner |
| `already-exists` | Уже есть активный доступ или ожидающее приглашение |
| `failed-precondition` | SMTP не настроен |

---

### `getParentInvitation`

Получить информацию о приглашении по токену из email-ссылки. Не требует авторизации.

**Auth:** не требуется  
**Payload:**

| Поле | Тип | Описание |
|------|-----|----------|
| `invitationId` | string | ID приглашения |
| `token` | string | Токен из ссылки |

**Response:**
```json
{
  "email": "parent@example.com",
  "ownerEmail": "owner@example.com",
  "status": "pending",
  "accountCreated": true,
  "expiresAt": "2025-01-02T12:00:00.000Z"
}
```

---

### `acceptParentInvitation`

Принять приглашение. Пользователь должен быть авторизован под invited email.

**Auth:** требуется (под аккаунтом приглашённого)  
**Payload:**

| Поле | Тип | Описание |
|------|-----|----------|
| `invitationId` | string | |
| `token` | string | |

**Response:**
```json
{
  "ownerUid": "...",
  "requiresPasswordChange": true
}
```

`requiresPasswordChange: true` означает, что был создан временный аккаунт — приложение должно предложить сменить пароль.

---

### `declineParentInvitation`

Отклонить приглашение. Авторизация не требуется.

**Auth:** не требуется  
**Payload:** `{ invitationId, token }`

**Response:**
```json
{
  "status": "declined",
  "cleanupAt": "2025-01-03T12:00:00.000Z"
}
```

---

### `revokeParentAccess`

Отозвать доступ вторичного родителя. Только owner.

**Auth:** требуется (только owner)  
**Payload:**

| Поле | Тип | Описание |
|------|-----|----------|
| `parentUid` | string | UID вторичного родителя |

**Response:** `{ "parentUid": "...", "status": "revoked" }`

---

## Real-time подписки (Firestore)

Все подписки возвращают функцию `unsubscribe()`. Вызывайте её при размонтировании компонента.

### Список устройств

```js
// Обновляется в real-time при изменении статуса/данных устройств
onSnapshot(
  collection(db, 'users', ownerUid, 'devices'),
  snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
)
```

### Правила устройства

```js
onSnapshot(
  query(
    collection(db, 'users', ownerUid, 'devices', deviceId, 'rules'),
    orderBy('createdAt', 'desc')
  ),
  snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
)
```

### Скриншоты

```js
onSnapshot(
  query(
    collection(db, 'users', ownerUid, 'devices', deviceId, 'screenshots'),
    orderBy('createdAt', 'desc')
  ),
  snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
)
```

### Логи активности (за день)

```js
const start = new Date(date); start.setHours(0, 0, 0, 0)
const end = new Date(date);   end.setHours(23, 59, 59, 999)

onSnapshot(
  query(
    collection(db, 'users', ownerUid, 'devices', deviceId, 'activityLogs'),
    where('ts', '>=', Timestamp.fromDate(start)),
    where('ts', '<=', Timestamp.fromDate(end)),
    orderBy('ts', 'desc'),
    limit(500)
  ),
  snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
)
```

### Статистика активности (последние N дней)

```js
// dates = ['2025-01-07', '2025-01-06', ...] — последние 7 дней
onSnapshot(
  query(
    collection(db, 'users', ownerUid, 'devices', deviceId, 'activityStats'),
    where('date', 'in', dates)
  ),
  snap => snap.docs.map(d => d.data()).sort((a, b) => b.date > a.date ? 1 : -1)
)
```

### Статистика за диапазон дат

```js
onSnapshot(
  query(
    collection(db, 'users', ownerUid, 'devices', deviceId, 'activityStats'),
    where('date', '>=', '2025-01-01'),
    where('date', '<=', '2025-01-31'),
    orderBy('date', 'desc')
  ),
  snap => snap.docs.map(d => d.data())
)
```

### Установленные приложения

```js
onSnapshot(
  collection(db, 'users', ownerUid, 'devices', deviceId, 'installedApps'),
  snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
)
```

### Алерты

```js
onSnapshot(
  query(
    collection(db, 'users', ownerUid, 'alerts'),
    orderBy('timestamp', 'desc')
  ),
  snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
)
```

### Чаты

```js
onSnapshot(
  collection(db, 'users', ownerUid, 'chats'),
  snap => snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
)
```

### Сообщения чата

```js
onSnapshot(
  query(
    collection(db, 'users', ownerUid, 'chats', chatId, 'messages'),
    orderBy('timestamp', 'asc'),
    limit(100)
  ),
  snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
)
```

### Список вторичных родителей

```js
onSnapshot(
  query(
    collection(db, 'users', ownerUid, 'parentAccess'),
    orderBy('acceptedAt', 'desc')
  ),
  snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
)
```

### Приглашения (история)

```js
onSnapshot(
  query(
    collection(db, 'users', ownerUid, 'parentInvitations'),
    orderBy('createdAt', 'desc')
  ),
  snap => snap.docs.map(d => ({ id: d.id, ...d.data() }))
)
```

### Профиль (квота хранилища и т.п.)

```js
onSnapshot(
  doc(db, 'users', ownerUid, 'profile', 'data'),
  snap => snap.exists() ? snap.data() : {}
)
```

---

## Прямые операции Firestore

### Псевдоним устройства

```js
await updateDoc(doc(db, 'users', ownerUid, 'devices', deviceId), { alias: 'Комната Артёма' })
```

### Удалить устройство

```js
await deleteDoc(doc(db, 'users', ownerUid, 'devices', deviceId))
```

### Добавить правило

```js
await addDoc(
  collection(db, 'users', ownerUid, 'devices', deviceId, 'rules'),
  {
    type: 'program',
    mode: 'permanent',
    status: 'active',
    program: { name: 'Steam' },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }
)
```

### Обновить правило

```js
await updateDoc(
  doc(db, 'users', ownerUid, 'devices', deviceId, 'rules', ruleId),
  { status: 'inactive', updatedAt: serverTimestamp() }
)
```

### Удалить правило

```js
await deleteDoc(doc(db, 'users', ownerUid, 'devices', deviceId, 'rules', ruleId))
```

### Помодоро-правило (глобальное, один документ на устройство)

```js
await setDoc(
  doc(db, 'users', ownerUid, 'devices', deviceId, 'rules', 'global_pomodoro'),
  { ...data, updatedAt: serverTimestamp() },
  { merge: true }
)
```

### Отправить сообщение в чат

```js
const msgRef = await addDoc(
  collection(db, 'users', ownerUid, 'chats', chatId, 'messages'),
  {
    text: 'Привет!',
    senderType: 'parent',
    senderUid: user.uid,
    senderName: 'Папа',
    timestamp: serverTimestamp(),
    readBy: [],
    deliveredTo: [],
    gifUrl: null, gifPreviewUrl: null,
    fileUrl: null, fileName: null, fileSize: null, mimeType: null,
    storagePath: null, fileDeleted: false
  }
)
// Обновить lastMessage в чате
await updateDoc(doc(db, 'users', ownerUid, 'chats', chatId), {
  lastMessage: { text: 'Привет!', senderName: 'Папа', timestamp: serverTimestamp() },
  updatedAt: serverTimestamp()
})
```

### Пометить алерт прочитанным

```js
await updateDoc(doc(db, 'users', ownerUid, 'alerts', alertId), { acknowledged: true })
```

### Обновить chatName (имя для детей)

```js
await setDoc(
  doc(db, 'users', ownerUid, 'profile', 'data'),
  { chatName: 'Папа' },
  { merge: true }
)
```

---

## Firebase Storage

### Пути к файлам

| Тип | Путь |
|-----|------|
| Скриншот | `users/{ownerUid}/devices/{deviceId}/screenshots/{filename}` |
| Миниатюра скриншота | `users/{ownerUid}/devices/{deviceId}/screenshots/thumbnails/{filename}` |
| Вложение чата | `users/{ownerUid}/chats/{chatId}/attachments/{filename}` |

### Получить URL скриншота

```js
import { getDownloadURL, ref } from 'firebase/storage'

// Миниатюра (быстрее)
const thumbnailPath = screenshot.thumbnailStoragePath || screenshot.storagePath
const url = await getDownloadURL(ref(storage, thumbnailPath))

// Полный размер
const fullUrl = await getDownloadURL(ref(storage, screenshot.storagePath))
```

### Удалить скриншот

```js
import { deleteObject, ref } from 'firebase/storage'

// Удалить файлы из Storage
for (const path of [screenshot.storagePath, screenshot.thumbnailStoragePath].filter(Boolean)) {
  await deleteObject(ref(storage, path))
}
// Удалить документ из Firestore
await deleteDoc(doc(db, 'users', ownerUid, 'devices', deviceId, 'screenshots', screenshotId))
```

---

## Важные ограничения

| Ограничение | Значение |
|-------------|----------|
| Квота хранилища (Free план) | 100 МБ |
| Автоочистка вложений чата | 7 дней |
| Автоочистка команд | 7 дней (статус completed/failed) |
| Автоочистка логов активности | 30 дней |
| Код сопряжения действует | 15 минут |
| Приглашение родителя действует | 24 часа |
| Лимит сообщений в одном запросе | 100 (limit в подписке) |
| Лимит логов активности за день | 500 |

---

## Права доступа (кратко)

| Ресурс | owner | parent | Агент (anonymous) |
|--------|-------|--------|-------------------|
| Устройства | ✅ CRUD | ✅ CRUD | ✅ R/W (только свой deviceId) |
| Правила | ✅ CRUD | ✅ CRUD | ✅ Read |
| Команды | ✅ (через CF) | ✅ (через CF) | ✅ Read + Update своих |
| Скриншоты | ✅ CRUD | ✅ CRUD | ✅ Create |
| Логи активности | ✅ Read | ✅ Read | ✅ Write |
| Статистика активности | ✅ Read | ✅ Read | ✅ Write |
| Алерты | ✅ Read | ✅ Read | ✅ Write |
| Чаты | ✅ CRUD | ✅ CRUD | ✅ R/W |
| Профиль | ✅ R/W | ✅ (свой) | ❌ |
| Управление родителями | ✅ (через CF) | ❌ | ❌ |
| Коды сопряжения | ✅ (через CF) | ✅ (через CF) | ❌ (через CF `pairDevice`) |
