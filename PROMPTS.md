# 🤖 Готові Промпти для ШІ-Агентів (Prompts Library)

Ці промпти призначені для копіювання та передачі у ваш улюблений ШІ-асистент (**Google Antigravity**, **Claude Code**, **OpenAI Codex**, **Cursor**, **Gemini CLI**). Агент виконає всю рутинну роботу самостійно під ключ.

---

## 📋 Промпт 1: Автономне розгортання та налаштування Truth Guard

> **Коли використовувати:** Запустіть цей промпт у вашому ШІ-асистенті, щоб він самостійно розгорнув MCP-сервер, налаштував безкоштовні ресурси Google Cloud (Firestore + Gemini API), створив векторний індекс та прописав сервер у конфігурації агентів.

```markdown
Твоя задача — повністю автономно розгорнути та підключити глобальну мультипроєктну антигалюциногенну MCP-систему `antigravity-truth-guard`, яка працює на безкоштовних лімітах (Firestore Free Tier + Google AI Studio Free Tier до 1500 запитів/добу).

Виконай усі кроки послідовно через консоль і файлову систему:

### Крок 1. Автоматична підготовка Google Cloud та API-ключа
1. Визнач активний GCP проект через `gcloud config get-value project` (якщо порожньо — запитай або використай існуючий проект із прив'язаним білінгом).
2. Переконайся, що увімкнені API:
   `gcloud services enable firestore.googleapis.com generativelanguage.googleapis.com apikeys.googleapis.com`
3. Перевір, чи створена база даних Firestore `(default)`. Якщо ні — створи її:
   `gcloud firestore databases create --location=eur3 --type=firestore-native` (або `nam5`).
4. Створи композитний векторний індекс для векторного пошуку у Firestore:
   `gcloud firestore indexes composite create --collection-group=truth_chunks --query-scope=COLLECTION --field-config=field-path=project_id,order=ASCENDING --field-config=field-path=embedding,vector-config='{"dimension":"768","flat":{}}' --quiet || true`
5. Отримай або створи ключ для Gemini API:
   - Перевір змінні оточення `GEMINI_API_KEY` або список ключів у `gcloud services api-keys list`.
   - Якщо ключа немає, створи: `gcloud services api-keys create --display-name="truth-guard-free-tier"` та отримай `keyString` через `get-key-string`.
   - Збережи у `.env` (якщо CLI не віддає ключ — налаштуй fallback на токен `gcloud auth application-default print-access-token`).

### Крок 2. Встановлення та налаштування Truth Guard
1. Створи директорію `~/.gemini/antigravity/truth-guard` (або схили репозиторій `antigravity-truth-guard`).
2. Встанови залежності:
   `npm install`
3. Створи файл `.env` із параметрами:
   ```env
   GEMINI_API_KEY="<отриманий_ключ>"
   GCP_PROJECT="<твій_gcp_project_id>"
   FIRESTORE_DATABASE="(default)"
   ```

### Крок 3. Реєстрація у конфігураціях агентів
Зареєструй MCP-сервер `antigravity-truth-guard` із командою `node <шлях>/server.mjs`:
- У `~/.gemini/config/mcp_config.json` (або `~/.gemini/antigravity/mcp_config.json`) для Antigravity.
- У `~/.claude/claude.json` для Claude Code.
- У `~/.codex/config.toml` для OpenAI Codex.

### Крок 4. Самотестування
Запусти `node self-test.mjs` та переконайся, що:
- RAM-дзеркало успішно синхронізоване з Firestore.
- 5 Загальних Законів проіндексовані.
- Тест семантичного пошуку `truth_search` та шлюз аудитора `truth_verify_plan` повертають успішні статуси.
```

---

## 🔒 Промпт 2: Впровадження примусового шлюзу верифікації у вашому проєкті (Enforcement Gate)

> **Коли використовувати:** Передайте цей промпт агенту всередині вашого робочого репозиторію (наприклад, вашого бекенду чи веб-додатка), щоб унеможливити будь-яке написання коду без перевірки та схвалення Truth Guard.

```markdown
Твоя задача — інтегрувати захисний шлюз верифікації Antigravity Truth Guard у цей проєкт, щоб жоден ШІ-агент не міг змінювати код без попередньої перевірки плану через MCP-сервер Truth Guard.

Виконай такі дії:

### 1. Додавання правил до інструкцій агента
Створи або онови файл правил агента у репозиторії (`AGENTS.md`, `.agent/rules/truth-guard-protocol.md` або `CLAUDE.md`):

```markdown
# Antigravity Truth Guard Protocol (Always On)

1. Закон 1 (Grounded Context): Заборонено здогадуватися про архітектуру, схеми баз даних чи бізнес-правила. Перед початком планування будь-якої задачі обов'язково виклич `truth_search`.
2. Закон 2 (Truth Verify Gate): Перед редагуванням будь-яких файлів коду (`src/`) обов'язково виклич `truth_verify_plan`, передавши свій план та масив `cited_fact_ids`. Якщо отримано `approved: false` — негайно зупинись, виправ порушення і повтори аудит.
3. Закон 3 (Spec Immutability): Заборонено самовільно змінювати файли специфікацій та правил без прямої команди користувача.
```

### 2. Додавання перевіряльника квитанцій (Receipt Gate)
1. Скопіюй або створи скрипт `scripts/check-receipt.mjs`, який перевіряє:
   - Якщо в робочому репозиторії є незакомічені зміни у коді (`src/`), обов'язково має існувати свіжий (не старіший за 30 хвилин) файл цифрової квитанції `.git/.truth-receipt.json`, згенерований `truth_verify_plan`.
   - Якщо квитанції немає або вона застаріла — скрипт аварійно завершується з `process.exit(1)` та інструкцією для агента викликати `truth_verify_plan`.
2. Додай виклик `node scripts/check-receipt.mjs` на самий початок скрипту `"verify"` (або `"test"`) у `package.json`:
   ```json
   "scripts": {
     "verify": "node scripts/check-receipt.mjs && tsc --noEmit && npm test"
   }
   ```

### 3. Перевірка роботи шлюзу
1. Спробуй внести невелику тестову правку у `src/` без виклику `truth_verify_plan` та запусти `npm run verify` — переконайся, що аудит падає з помилкою.
2. Виклич `truth_verify_plan` для узгодженого плану, переконайся у створенні чека `.git/.truth-receipt.json`, і знову запусти `npm run verify` — переконайся, що шлюз успішно пропускає тести.
```
