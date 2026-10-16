# 이메일 자동 발송 설정 가이드

## 📧 개요

VAQ2 시스템에서 공기질 데이터를 자동으로 이메일로 발송하는 기능입니다.

**기능:**
- ✅ 일일 공기질 리포트 (매일 지정된 시간)
- ✅ HTML 형식의 깔끔한 리포트
- ✅ 평균/최대값 통계
- ✅ 현재 상태 표시

---

## 📝 설정 방법

### 1단계: Gmail 앱 비밀번호 생성

Gmail을 사용하는 경우 (권장):

1. **Google 계정 설정** 접속: https://myaccount.google.com/
2. **보안** 메뉴로 이동
3. **2단계 인증** 활성화 (필수!)
   - 아직 활성화하지 않았다면 먼저 설정
4. **앱 비밀번호** 생성:
   - 검색창에 "앱 비밀번호" 검색
   - "앱 선택" → 기타 (맞춤 이름) → "VAQ2"
   - "생성" 클릭
   - **16자리 비밀번호 복사** (예: abcd efgh ijkl mnop)
   - 공백 제거하여 저장: `abcdefghijklmnop`

### 2단계: config.yaml 설정

**파일:** `plc_modbus_bridge/config.yaml`

```yaml
email:
  enabled: true  # 활성화
  smtp_server: "smtp.gmail.com"
  smtp_port: 587
  sender_email: "your_email@gmail.com"  # 발신자 Gmail 주소
  sender_password: "abcdefghijklmnop"   # 앱 비밀번호 (16자리)
  receiver_emails:  # 수신자 목록 (여러 명 가능)
    - "manager@company.com"
    - "admin@company.com"
  
  # 리포트 발송 설정
  daily_report_time: "18:00"  # 매일 오후 6시 발송
  weekly_report_day: 5        # 0=월요일, 5=토요일
  
  # 긴급 알림 (추후 확장 가능)
  emergency_alert: false
  emergency_threshold: "bad"
```

### 3단계: 서버 재시작

```powershell
cd C:\Users\SAERON02\Desktop\vaq2\plc_modbus_bridge
python main.py
```

**정상 실행 시 로그:**
```
[이메일] 자동 발송 시작 - 일일 리포트: 18:00
```

---

## 📊 발송되는 리포트 내용

### 1. 오늘의 통계
- CO2 평균/최대값
- PM2.5 평균/최대값
- 온도/습도 평균

### 2. 현재 상태
- 최근 측정값 (모든 센서)
- 측정 시간

### 3. HTML 형식
- 보기 좋은 테이블 형식
- 색상과 스타일 적용
- 모바일에서도 잘 보임

---

## ⏰ 발송 시간 설정

### 일일 리포트

**매일 오후 6시:**
```yaml
daily_report_time: "18:00"
```

**매일 오전 9시:**
```yaml
daily_report_time: "09:00"
```

**하루 2회 (수동 구현 필요):**
- 현재는 1회만 지원
- 여러 시간에 발송하려면 추가 개발 필요

---

## 📧 다른 이메일 서비스 사용

### Naver 메일

```yaml
email:
  smtp_server: "smtp.naver.com"
  smtp_port: 587
  sender_email: "your_id@naver.com"
  sender_password: "your_password"
```

### 회사 메일 (Office 365)

```yaml
email:
  smtp_server: "smtp.office365.com"
  smtp_port: 587
  sender_email: "your_email@company.com"
  sender_password: "your_password"
```

### 자체 SMTP 서버

```yaml
email:
  smtp_server: "mail.yourcompany.com"
  smtp_port: 25  # 또는 465, 587
  sender_email: "airquality@yourcompany.com"
  sender_password: "password"
```

---

## ❗ 주의사항

### 1. Gmail 보안

- **앱 비밀번호 사용 필수** (일반 비밀번호는 작동 안 함)
- 2단계 인증 필수
- 앱 비밀번호는 안전하게 보관

### 2. 이메일 발송 제한

- Gmail: 하루 500명 제한
- 대량 발송 필요 시 전용 메일 서비스 사용 권장

### 3. 개인정보 보호

- `config.yaml`에 비밀번호 저장
- Git에 커밋하지 않도록 주의
- `.gitignore`에 `config.yaml` 추가 권장

---

## 🧪 테스트

### 즉시 테스트 발송

리포트 발송 시간을 현재 시간 1분 후로 설정:

```yaml
daily_report_time: "16:45"  # 현재 16:44면 16:45로 설정
```

서버 재시작 후 1분 대기하면 이메일이 발송됩니다.

**확인:**
- 수신자 이메일 받은편지함 확인
- 스팸 폴더도 확인

---

## 🔧 문제 해결

### 1. 이메일이 발송되지 않음

**확인사항:**
- `enabled: true`로 설정했는지
- 발신자 이메일과 앱 비밀번호가 정확한지
- 2단계 인증이 활성화되어 있는지
- 네트워크 연결 확인

**로그 확인:**
```
[이메일] ❌ 발송 실패: [에러 메시지]
```

### 2. "535 Authentication failed" 오류

**원인:** 앱 비밀번호가 잘못됨

**해결:**
- Google 계정에서 앱 비밀번호 재생성
- 공백 없이 16자리 정확히 입력

### 3. "SMTPAuthenticationError" 오류

**원인:** 2단계 인증 없음

**해결:**
- Google 계정에서 2단계 인증 활성화

### 4. 이메일이 스팸으로 분류됨

**해결:**
- 발신자를 주소록에 추가
- 이메일 제목에 특정 키워드 피하기

---

## 🎯 발송 시간 예시

```yaml
# 출근 전
daily_report_time: "08:00"

# 점심 시간
daily_report_time: "12:00"

# 퇴근 전
daily_report_time: "18:00"

# 밤 10시
daily_report_time: "22:00"
```

---

## 📮 리포트 샘플

**제목:**
```
[VAQ2] 조리실 공기질 일일 리포트 - 2026-01-09
```

**내용:**
- 오늘의 통계 (평균/최대값)
- 현재 상태 (최근 측정값)
- HTML 테이블로 보기 좋게 표시

---

**설정 완료! 📧**
