# 계산기 앱 — DB 스키마

계산 내역과 프로젝트 데이터를 저장하는 브라우저 내장 DB(IndexedDB) 구조 문서입니다.

## DB 기본 구성

| 항목 | 값 |
|---|---|
| 종류 | IndexedDB (브라우저 내장 DB) |
| DB 이름 | `calcAppDB` |
| 버전 | `1` |
| 오브젝트 스토어 | `history`, `projects` (2개) |
| 폴백 | IndexedDB 불가 시 `localStorage` (`calc-history`, `calc-projects`) |

**저장 방식**: 데이터 변경 시마다 해당 스토어를 전체 비우고(clear) 현재 데이터로 다시 저장(put).
불러올 때는 `time` 기준 최신순 정렬로 순서를 복원합니다. (IndexedDB는 키 순서로 반환하므로 정렬로 순서 보존)

**저장소 범위**: 브라우저 저장소는 출처(origin)별로 분리됩니다. 같은 브라우저·같은 주소에서는 재시작 후에도 유지되지만, 다른 브라우저·기기·포트에서는 공유되지 않습니다.

---

## 테이블 1 — `history` (계산 내역)

- **Key**: `id` (keyPath, 기본키) · 인덱스 없음

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 고유 ID (UUID) — 기본키 |
| `expr` | string | 계산식 (표시용, 예: `"25×4"`) |
| `result` | string | 결과값 (천단위 콤마 포함, 예: `"100"`) |
| `note` | string | 메모 (없으면 `""`) |
| `urls` | array | 내역별 URL 목록 → `{ id, label, url }` 객체 배열 |
| `projectId` | string \| null | 담긴 프로젝트 ID (미지정 시 `null`) → `projects.id` 참조 |
| `time` | number | 생성 시각 (epoch ms, 정렬·최신순 기준) |

### `urls` 배열 요소 구조

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | URL 고유 ID |
| `label` | string | 표시 이름 (선택, 없으면 `""`) |
| `url` | string | 주소 원문 |

### 레코드 예시

```json
{
  "id": "a1b2c3d4-...",
  "expr": "25×4",
  "result": "100",
  "note": "점심값 정산",
  "urls": [
    { "id": "u1-...", "label": "영수증 사진", "url": "example.com/receipt-1" }
  ],
  "projectId": "p1-...",
  "time": 1793167165736
}
```

---

## 테이블 2 — `projects` (프로젝트)

- **Key**: `id` (keyPath, 기본키) · 인덱스 없음

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 고유 ID (UUID) — 기본키 |
| `title` | string | 프로젝트 제목 |
| `time` | number | 생성 시각 (epoch ms, 정렬 기준) |

### 레코드 예시

```json
{
  "id": "p1-...",
  "title": "10월 가계부",
  "time": 1793166500000
}
```

---

## 관계

```
projects (1) ──────< (N) history
   id        ◄────── projectId   (nullable, 미지정이면 null)

history (1) ──embed──> urls[]     (내역 레코드 안에 배열로 내장)
```

- **프로젝트 ↔ 계산 내역**: 1:N. 계산 내역이 `projectId`로 프로젝트를 참조하는 느슨한 연결.
  프로젝트를 삭제해도 내역은 지워지지 않고 `projectId`만 `null`로 돌아갑니다.
- **URL**: 별도 테이블이 아니라 각 계산 내역 레코드 안에 `urls` 배열로 내장됩니다.
  (프로젝트 단위 URL은 제거되어 `projects`에는 URL 필드가 없습니다.)

---

## 주요 저장소 함수 (`script.js`)

| 함수 | 역할 |
|---|---|
| `openDB()` | DB 열기 / 스토어 생성 (`onupgradeneeded`) |
| `dbGetAll(store)` | 스토어 전체 레코드 조회 |
| `dbReplaceAll(store, records)` | 스토어 전체 교체 (clear 후 put) |
| `saveHistory()` / `saveProjects()` | 메모리 배열을 DB(또는 localStorage)에 저장 |
| `normalizeHistory()` / `normalizeProjects()` | 로드 데이터 정규화 + 최신순 정렬 |
| `readLocal(key)` | localStorage 폴백 읽기 |
| `init()` | DB 열기 → (필요 시) localStorage 1회 마이그레이션 → 로드 → 렌더 |
