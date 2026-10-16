# Google Sheets 자동 업로드 설정 가이드

## 1단계: Google Cloud 프로젝트 생성

1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. 새 프로젝트 생성 또는 기존 프로젝트 선택
3. 프로젝트 이름: 예) "공기질모니터링"

## 2단계: Google Sheets API 활성화

1. 좌측 메뉴 → "API 및 서비스" → "라이브러리"
2. "Google Sheets API" 검색
3. "사용 설정" 클릭
4. "Google Drive API"도 동일하게 활성화

## 3단계: 서비스 계정 생성

1. 좌측 메뉴 → "API 및 서비스" → "사용자 인증 정보"
2. "사용자 인증 정보 만들기" → "서비스 계정" 선택
3. 서비스 계정 이름: 예) "airquality-uploader"
4. "만들기 및 계속하기" 클릭
5. 역할 선택: "편집자" (선택사항)
6. "완료" 클릭

## 4단계: JSON 키 파일 다운로드

1. 생성된 서비스 계정 클릭
2. "키" 탭으로 이동
3. "키 추가" → "새 키 만들기"
4. 키 유형: "JSON" 선택
5. "만들기" 클릭 → JSON 파일 자동 다운로드
6. 다운로드된 파일을 `credentials.json`으로 이름 변경
7. 이 파일을 `plc_modbus_bridge` 폴더에 복사

## 5단계: Google Sheets 생성 및 공유

1. [Google Sheets](https://sheets.google.com) 접속
2. 새 스프레드시트 생성
3. 제목: 예) "공기질 데이터"
4. **중요!** 스프레드시트를 서비스 계정 이메일과 공유:
   - 우측 상단 "공유" 버튼 클릭
   - 서비스 계정 이메일 입력 (예: airquality-uploader@프로젝트명.iam.gserviceaccount.com)
   - 권한: "편집자"
   - "완료" 클릭

5. 스프레드시트 ID 복사:
   - URL에서 ID 확인: `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`
   - 예시: `1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789`

## 6단계: config.yaml 설정

```yaml
google_sheets:
  enabled: true
  credentials_file: "credentials.json"
  spreadsheet_id: "여기에_복사한_스프레드시트_ID_입력"
  sheet_name: "공기질데이터"
  upload_interval_min: 60  # 60분마다 업로드
```

## 7단계: 라이브러리 설치

```bash
cd C:\Users\SAERON02\Desktop\vaq2\plc_modbus_bridge
pip install gspread oauth2client
```

또는

```bash
pip install -r requirements.txt
```

## 8단계: 서버 재시작

```bash
python main.py
```

## 확인사항

서버 실행 시 다음 로그가 보이면 정상:
- `[Google Sheets] 업로드 시작 - 간격: 60분`

60분 후:
- `[Google Sheets] ✅ XX개 행 업로드 완료`

## 에러 해결

### `credentials.json`을 찾을 수 없음
→ JSON 파일이 `plc_modbus_bridge` 폴더에 있는지 확인

### 권한 거부 오류
→ Google Sheets를 서비스 계정 이메일과 공유했는지 확인

### `gspread` 모듈 없음
→ `pip install gspread oauth2client` 실행

## 데이터 형식

업로드되는 데이터:
- 시간
- 요일 (월/화/수/목/금/토/일)
- CO2 (ppm)
- PM2.5 (μg/m³)
- PM10 (μg/m³)
- VOC (ppb)
- 포름알데히드 (μg/m³)
- CO (ppm)
- 온도 (°C)
- 습도 (%)

## 업로드 주기 변경

`config.yaml`에서 `upload_interval_min` 값 조정:
- `5`: 5분마다
- `15`: 15분마다
- `60`: 1시간마다 (기본값)
- `1440`: 하루 1번
