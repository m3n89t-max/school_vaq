import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePLCAlert } from '../hooks/usePLCAlert';
import MetricChartModal from '../components/MetricChartModal';

// 메트릭 정보 매핑
const metricInfo: Record<string, { name: string; unit: string; maxValue: number }> = {
  'pm25': { name: '초미세먼지(PM2.5)', unit: 'µg/m³', maxValue: 200 },
  'pm10': { name: '미세먼지(PM10)', unit: 'µg/m³', maxValue: 400 },
  'co2': { name: '이산화탄소(CO2)', unit: 'ppm', maxValue: 5000 },
  'co': { name: '일산화탄소(CO)', unit: 'ppm', maxValue: 50 },
  'voc': { name: '유기화합물(VOC)', unit: 'ppb', maxValue: 2000 },
  'formaldehyde': { name: '포름알데히드', unit: 'μg/m³', maxValue: 500 }
};

// 게이지 상태 클래스 결정
function getGaugeStatusClass(value: number, type: string): string {
  const thresholds: Record<string, any> = {
    'pm25': { veryGood: 35, good: 75, normal: 99, bad: 109 },
    'pm10': { veryGood: 80, good: 150, normal: 199, bad: 219 },
    'co2': { veryGood: 1000, good: 1500, normal: 2000, bad: 2199 },
    'co': { veryGood: 10, good: 20, normal: 24, bad: 26 },
    'voc': { veryGood: 400, good: 1000, normal: 1199, bad: 1319 },
    'formaldehyde': { veryGood: 80, good: 130, normal: 199, bad: 300 }
  };
  
  const threshold = thresholds[type];
  if (!threshold) return 'status-very-good';
  
  if (value <= threshold.veryGood) return 'status-very-good';
  if (value <= threshold.good) return 'status-good';
  if (value <= threshold.normal) return 'status-normal';
  if (value <= threshold.bad) return 'status-bad';
  return 'status-very-bad';
}

// 게이지 fill 클래스 결정
function getGaugeFillClass(value: number, type: string): string {
  const statusClass = getGaugeStatusClass(value, type);
  if (statusClass.includes('very-good')) return 'very-good';
  if (statusClass.includes('good') && !statusClass.includes('very-good')) return 'good';
  if (statusClass.includes('normal')) return 'moderate';
  if (statusClass.includes('bad') && !statusClass.includes('very-bad')) return 'bad';
  if (statusClass.includes('very-bad')) return 'very-bad';
  return 'very-good';
}

// 원형 게이지 컴포넌트 (React.memo로 최적화)
const CircularGauge = React.memo(({ type, value, room, onClick }: { type: string; value: number; room: string; onClick?: () => void }) => {
  const info = metricInfo[type];
  if (!info) return null;

  // 포름알데히드는 PLC에서 10배 값으로 전송되므로 /10 처리
  const displayValue = type === 'formaldehyde' ? value / 10 : value;

  const statusClass = getGaugeStatusClass(displayValue, type);
  const fillClass = getGaugeFillClass(displayValue, type);
  
  // 퍼센티지 계산
  const percentage = Math.min(100, Math.max(0, (displayValue / info.maxValue) * 100));
  const circumference = 483.8; // 2 * PI * 77
  const offset = circumference - (circumference * percentage) / 100;

  return (
    <div className="metric-card">
      <div className="metric-label">{info.name}</div>
      <div 
        className={`circular-gauge ${statusClass}`} 
        id={`${room}-${type}`} 
        data-metric={type}
        onClick={(e) => {
          e.stopPropagation(); // 이벤트 전파 방지
          onClick?.();
        }}
        style={{ cursor: 'pointer' }}
      >
        <svg className="gauge-progress" viewBox="0 0 170 170">
          <circle className="gauge-bg" cx="85" cy="85" r="77" />
          <circle 
            className={`gauge-fill ${fillClass}`} 
            cx="85" 
            cy="85" 
            r="77"
            style={{ strokeDashoffset: offset }}
          />
        </svg>
        <div className="gauge-value">
          <span className="value">
            {type === 'formaldehyde' ? displayValue.toFixed(1) : displayValue.toFixed(0)}
          </span>
          <span className="unit">{info.unit}</span>
        </div>
      </div>
    </div>
  );
});

export default function Dashboard() {
  const { data, connected } = useWebSocket();
  const { aiAlert } = usePLCAlert();
  const [currentTime, setCurrentTime] = useState(new Date());

  // 각 방의 개별 연결 상태 판단 (데이터 수신 여부 기반)
  const kitchenConnected = connected && data?.kitchen && (
    data.kitchen.co2 !== 0 || data.kitchen.pm25 !== 0 || data.kitchen.pm10 !== 0
  );
  const washingConnected = connected && data?.washing && (
    data.washing.co2 !== 0 || data.washing.pm25 !== 0 || data.washing.pm10 !== 0
  );


  // 차트 모달 상태
  const [chartModal, setChartModal] = useState<{ isOpen: boolean; metric: string; metricName: string; room: string }>({
    isOpen: false,
    metric: '',
    metricName: '',
    room: 'kitchen',
  });
  
  // 맵 팝업 상태
  const [isMapPopupOpen, setIsMapPopupOpen] = useState(false);
  
  // 전체 화면 이미지 뷰어 상태
  const [fullscreenImage, setFullscreenImage] = useState<{ isOpen: boolean; src: string; title: string }>({
    isOpen: false,
    src: '',
    title: ''
  });

  // 전체 화면 이미지 확대/축소 상태
  const [fullscreenScale, setFullscreenScale] = useState(1);
  const [fullscreenPosition, setFullscreenPosition] = useState({ x: 0, y: 0 });
  const [fullscreenDragging, setFullscreenDragging] = useState(false);
  const [fullscreenDragStart, setFullscreenDragStart] = useState({ x: 0, y: 0 });
  const [fullscreenTouchDistance, setFullscreenTouchDistance] = useState<number | null>(null);
  const [fullscreenTouchScale, setFullscreenTouchScale] = useState(1);

  // 추가 도면 이미지 목록
  const additionalImages = [
    { src: '/급배기닥트 평면도.png', title: '급·배기 닥트 평면도' },
    { src: '/옥상닥트배관 및 장비배치도.png', title: '옥상 닥트배관 및 장비 배치도' },
    { src: '/장비일람표.png', title: '장비 일람표' }
  ];

  // 마우스 커서 자동 숨김 (3초 후)
  const cursorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleMouseMove = () => {
      // 커서 보이기
      document.body.classList.remove('hide-cursor');
      document.body.style.cursor = 'default';
      
      // 기존 타이머 제거
      if (cursorTimeoutRef.current) {
        clearTimeout(cursorTimeoutRef.current);
      }
      
      // 3초 후 커서 숨기기
      cursorTimeoutRef.current = setTimeout(() => {
        document.body.classList.add('hide-cursor');
        document.body.style.cursor = 'none';
      }, 3000);
    };

    // 마우스 움직임 감지
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mousedown', handleMouseMove);
    
    // 초기 타이머 설정 (페이지 로드 후 3초)
    cursorTimeoutRef.current = setTimeout(() => {
      document.body.classList.add('hide-cursor');
      document.body.style.cursor = 'none';
    }, 3000);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mousedown', handleMouseMove);
      if (cursorTimeoutRef.current) {
        clearTimeout(cursorTimeoutRef.current);
      }
      // 컴포넌트 언마운트 시 커서 복원
      document.body.classList.remove('hide-cursor');
      document.body.style.cursor = 'default';
    };
  }, []);

  // 시간 업데이트 (메모리 최적화)
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // 1분마다
    
    return () => {
      clearInterval(timer);
    };
  }, []);

  // 드래그 관련 함수들 제거됨 (맵 고정)

  // 전체 화면 이미지 확대/축소 (마우스 휠)
  const handleFullscreenWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setFullscreenScale(prev => Math.min(Math.max(0.5, prev + delta), 5));
  };

  // 두 터치점 사이의 거리 계산
  const getTouchDistance = (touches: React.TouchList): number => {
    const touch1 = touches[0];
    const touch2 = touches[1];
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // 전체 화면 터치 시작
  const handleFullscreenTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = getTouchDistance(e.touches);
      setFullscreenTouchDistance(distance);
      setFullscreenTouchScale(fullscreenScale);
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      setFullscreenDragging(true);
      setFullscreenDragStart({ 
        x: touch.clientX - fullscreenPosition.x, 
        y: touch.clientY - fullscreenPosition.y 
      });
    }
  };

  // 전체 화면 터치 이동
  const handleFullscreenTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && fullscreenTouchDistance !== null) {
      e.preventDefault();
      const distance = getTouchDistance(e.touches);
      const scale = fullscreenTouchScale * (distance / fullscreenTouchDistance);
      setFullscreenScale(Math.min(Math.max(0.5, scale), 5));
    } else if (e.touches.length === 1 && fullscreenDragging) {
      const touch = e.touches[0];
      setFullscreenPosition({
        x: touch.clientX - fullscreenDragStart.x,
        y: touch.clientY - fullscreenDragStart.y
      });
    }
  };

  // 전체 화면 터치 종료
  const handleFullscreenTouchEnd = () => {
    setFullscreenDragging(false);
    setFullscreenTouchDistance(null);
  };

  // 전체 화면 마우스 드래그 시작
  const handleFullscreenMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setFullscreenDragging(true);
    setFullscreenDragStart({ 
      x: e.clientX - fullscreenPosition.x, 
      y: e.clientY - fullscreenPosition.y 
    });
  };

  // 전체 화면 마우스 드래그 중
  const handleFullscreenMouseMove = (e: React.MouseEvent) => {
    if (!fullscreenDragging) return;
    setFullscreenPosition({
      x: e.clientX - fullscreenDragStart.x,
      y: e.clientY - fullscreenDragStart.y
    });
  };

  // 전체 화면 마우스 드래그 종료
  const handleFullscreenMouseUp = () => {
    setFullscreenDragging(false);
  };

  // 전체 화면 더블클릭으로 리셋
  const handleFullscreenDoubleClick = () => {
    setFullscreenScale(1);
    setFullscreenPosition({ x: 0, y: 0 });
  };

  // 전체 화면 닫기 (상태 초기화)
  const closeFullscreenImage = () => {
    setFullscreenImage({ isOpen: false, src: '', title: '' });
    setFullscreenScale(1);
    setFullscreenPosition({ x: 0, y: 0 });
    setFullscreenDragging(false);
  };

  // 차트 모달 열기
  const openChart = (metric: string, room: string = 'kitchen') => {
    const info = metricInfo[metric];
    if (info) {
      setChartModal({
        isOpen: true,
        metric: metric,
        metricName: info.name,
        room: room,
      });
    }
  };

  // 차트 모달 닫기
  const closeChart = () => {
    setChartModal({ isOpen: false, metric: '', metricName: '', room: 'kitchen' });
  };

  const formatDateTime = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}.${month}.${day} ${hours}:${minutes}`;
  };

  // AI 알림 파싱 (다중 줄 지원 - Prophet 예보용)
  const parseAlert = (alert: string) => {
    const lines = alert.split('\n').filter(line => line.trim());
    return {
      line1: lines[0] || '실시간 공기질 분석 중...',
      line2: lines.slice(1).join('\n') || ''  // 2줄 이상은 모두 표시
    };
  };

  const { line1, line2 } = parseAlert(aiAlert);

  // AI 알림 텍스트에서 상태 키워드만 색상 적용
  const getStatusColor = (status: string): string => {
    switch (status) {
      case '매우좋음': return 'rgb(146, 208, 80)'; // 초록색
      case '좋음': return 'rgb(240, 239, 0)'; // 노란색
      case '보통': return 'rgb(255, 192, 0)'; // 주황색
      case '나쁨': return 'rgb(240, 0, 0)'; // 빨간색
      case '매우나쁨': return 'rgb(128, 0, 128)'; // 보라색
      default: return '#FFFFFF';
    }
  };

  // 텍스트에서 상태 키워드를 찾아 색상이 적용된 JSX로 변환
  const renderColoredText = useCallback((text: string) => {
    // ✅ 긴 키워드를 먼저 확인 (매우나쁨, 매우좋음이 나쁨, 좋음보다 먼저)
    const statusKeywords = ['매우나쁨', '매우좋음', '나쁨', '좋음', '보통'];
    
    // 모든 키워드의 위치를 찾기 (겹치지 않게)
    const matches: Array<{ keyword: string; index: number; length: number }> = [];
    
    for (const keyword of statusKeywords) {
      let index = text.indexOf(keyword);
      while (index !== -1) {
        // 이미 매칭된 범위와 겹치는지 확인
        const overlaps = matches.some(m => 
          (index >= m.index && index < m.index + m.length) ||
          (index + keyword.length > m.index && index < m.index + m.length)
        );
        
        if (!overlaps) {
          matches.push({ keyword, index, length: keyword.length });
        }
        
        index = text.indexOf(keyword, index + 1);
      }
    }
    
    // 위치순으로 정렬
    matches.sort((a, b) => a.index - b.index);
    
    if (matches.length === 0) {
      return text;
    }
    
    // 텍스트를 조각내고 색상 적용
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    
    for (const match of matches) {
      // 이전 텍스트
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      
      // 키워드에 색상 적용
      parts.push(
        <span 
          key={match.index} 
          style={{ color: getStatusColor(match.keyword), fontWeight: 900 }}
        >
          {match.keyword}
        </span>
      );
      
      lastIndex = match.index + match.length;
    }
    
    // 나머지 텍스트
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    
    return <>{parts}</>;
  }, []);



  // WebSocket 데이터 또는 기본값 (안전한 기본값)
  const kitchen = useMemo(() => ({
    pm10: data?.kitchen?.pm10 ?? 0,
    pm25: data?.kitchen?.pm25 ?? 0,
    co2: data?.kitchen?.co2 ?? 0,
    voc: data?.kitchen?.voc ?? 0,
    formaldehyde: data?.kitchen?.formaldehyde ?? 0,
    co: data?.kitchen?.co ?? 0,
    temperature: data?.kitchen?.temperature ?? 0,
    humidity: data?.kitchen?.humidity ?? 0
  }), [data]);

  const washing = useMemo(() => ({
    pm10: data?.washing?.pm10 ?? 0,
    pm25: data?.washing?.pm25 ?? 0,
    co2: data?.washing?.co2 ?? 0,
    voc: data?.washing?.voc ?? 0,
    formaldehyde: data?.washing?.formaldehyde ?? 0,
    co: data?.washing?.co ?? 0,
    temperature: data?.washing?.temperature ?? 0,
    humidity: data?.washing?.humidity ?? 0
  }), [data]);


  return (
    <div className="dashboard-container">
      {/* 상단 헤더 */}
      <header className="dashboard-header">
        <div className="header-left">
          <div className="system-title">
            <img src="/그림1.png" alt="Logo" className="logo-image" />
            <span>새론환기시스템</span>
            <span className="contact-number">문의 : 1577-6706</span>
          </div>
        </div>
        <div className="header-center">
          <h1 className="main-title" style={{ fontSize: '48px' }}>조리실 Visual Air Quality (VAQ)</h1>
        </div>
        <div className="header-right">
          <div className="datetime">{formatDateTime(currentTime)}</div>
          <div className="quality-legend">
            <div className="legend-item">
              <div className="legend-color" style={{ backgroundColor: 'rgb(146, 208, 80)' }}></div>
              <span>매우좋음</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ backgroundColor: 'rgb(240, 239, 0)' }}></div>
              <span>좋음</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ backgroundColor: 'rgb(255, 192, 0)' }}></div>
              <span>보통</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ backgroundColor: 'rgb(240, 0, 0)' }}></div>
              <span>나쁨</span>
            </div>
            <div className="legend-item">
              <div className="legend-color" style={{ backgroundColor: 'rgb(128, 0, 128)' }}></div>
              <span>매우나쁨</span>
            </div>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 영역 */}
      <main className="main-content">
        {/* 조리실 패널 */}
        <div className="room-panel" id="kitchen-panel">
          <div className="room-title">
            <img src="/조리실.png" alt="조리실" className="room-icon-img" />
            조리실
          </div>
          <div className="air-quality-grid">
            <CircularGauge type="pm25" value={kitchen.pm25} room="kitchen" onClick={() => openChart('pm25', 'kitchen')} />
            <CircularGauge type="pm10" value={kitchen.pm10} room="kitchen" onClick={() => openChart('pm10', 'kitchen')} />
            <CircularGauge type="co2" value={kitchen.co2} room="kitchen" onClick={() => openChart('co2', 'kitchen')} />
            <CircularGauge type="voc" value={kitchen.voc} room="kitchen" onClick={() => openChart('voc', 'kitchen')} />
            <CircularGauge type="formaldehyde" value={kitchen.formaldehyde} room="kitchen" onClick={() => openChart('formaldehyde', 'kitchen')} />
            <CircularGauge type="co" value={kitchen.co} room="kitchen" onClick={() => openChart('co', 'kitchen')} />
          </div>
        </div>

        {/* AI 공기질 알람 (중앙) */}
        <div className="chatgpt-middle-panel">
          <div className="chatgpt-title">
            <span className="chatgpt-title-text" style={{ fontSize: '24px', fontWeight: '700' }}>AI 공기질 알림 (현재+예보)</span>
          </div>
          <div style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '40px 30px',
            backgroundColor: '#000000'
          }}>
            {/* 알림 1줄: 상태 및 현황 (키워드만 색상 적용) */}
            <div style={{
              fontSize: '36px',
              fontWeight: 800,
              color: '#FFFFFF',
              textAlign: 'center',
              lineHeight: 1.3,
              marginBottom: '20px',
              letterSpacing: '0px',
              textShadow: '2px 2px 4px rgba(0,0,0,0.5)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif',
              whiteSpace: 'normal',
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              width: '100%',
              maxWidth: '100%'
            }}>
              {renderColoredText(line1)}
            </div>
            
            {/* 알림 2줄: 조치 사항 */}
            {line2 && (
              <div style={{
                fontSize: '32px',
                fontWeight: 700,
                color: '#4dabf7',
                textAlign: 'center',
                lineHeight: 1.4,
                letterSpacing: '0px',
                backgroundColor: 'rgba(77, 171, 247, 0.1)',
                padding: '18px 25px',
                borderRadius: '10px',
                border: '2px solid rgba(77, 171, 247, 0.3)',
                boxShadow: '0 3px 10px rgba(77, 171, 247, 0.2)',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif',
                whiteSpace: 'normal',
                wordBreak: 'keep-all',
                overflowWrap: 'break-word',
                width: '100%',
                maxWidth: '100%'
              }}>
                👉 {line2}
              </div>
            )}
            
            {/* 추가 정보 */}
            <div style={{
              fontSize: '13px',
              color: '#adb5bd',
              marginTop: '30px',
              textAlign: 'center',
              lineHeight: 1.6
            }}>
              <div>✨ 학교 공기질 기준표 기반 정밀 분석</div>
              <div>📊 실시간 공기질 모니터링 (5초 간격)</div>
              <div>🧠 과거 7일 데이터 학습 · 선제적 환기 권고</div>
            </div>
          </div>
        </div>

        {/* 세척실 패널 */}
        <div className="room-panel" id="washing-panel">
          <div className="room-title">
            <img src="/세척실.png" alt="세척실" className="room-icon-img" />
            세척실
          </div>
          <div className="air-quality-grid">
            <CircularGauge type="pm25" value={washing.pm25} room="washing" onClick={() => openChart('pm25', 'washing')} />
            <CircularGauge type="pm10" value={washing.pm10} room="washing" onClick={() => openChart('pm10', 'washing')} />
            <CircularGauge type="co2" value={washing.co2} room="washing" onClick={() => openChart('co2', 'washing')} />
            <CircularGauge type="voc" value={washing.voc} room="washing" onClick={() => openChart('voc', 'washing')} />
            <CircularGauge type="formaldehyde" value={washing.formaldehyde} room="washing" onClick={() => openChart('formaldehyde', 'washing')} />
            <CircularGauge type="co" value={washing.co} room="washing" onClick={() => openChart('co', 'washing')} />
          </div>
        </div>

      </main>

      {/* 하단 패널 영역 */}
      <div className="bottom-panels">
        {/* 급배기 그룹 */}
        <div className="panel-group">
          <div className="control-panel" style={{ opacity: 0.6, pointerEvents: 'none' }}>
            <div className="control-panel-header">
              <span className="status-indicator off"></span>
              <h3 className="control-panel-title">조리실 급배기</h3>
            </div>
            <div className="ventilation-controls">
              <div className="vent-item">
                <div className="fan-icon inactive">
                  <img src="/Xisom_Fan_22.svg" alt="Supply Fan" />
                </div>
                <div className="vent-info-box">
                  <div className="vent-label">급기</div>
                  <div className="vent-speed">0%</div>
                </div>
              </div>
              <div className="vent-item">
                <div className="fan-icon inactive">
                  <img src="/Xisom_Fan_22.svg" alt="Exhaust Fan" />
                </div>
                <div className="vent-info-box">
                  <div className="vent-label">배기</div>
                  <div className="vent-speed">0%</div>
                </div>
              </div>
            </div>
          </div>

          <div className="control-panel" style={{ opacity: 0.6, pointerEvents: 'none' }}>
            <div className="control-panel-header">
              <span className="status-indicator off"></span>
              <h3 className="control-panel-title">세척실 급배기</h3>
            </div>
            <div className="ventilation-controls">
              <div className="vent-item">
                <div className="fan-icon inactive">
                  <img src="/Xisom_Fan_22.svg" alt="Supply Fan" />
                </div>
                <div className="vent-info-box">
                  <div className="vent-label">급기</div>
                  <div className="vent-speed">0%</div>
                </div>
              </div>
              <div className="vent-item">
                <div className="fan-icon inactive">
                  <img src="/Xisom_Fan_22.svg" alt="Exhaust Fan" />
                </div>
                <div className="vent-info-box">
                  <div className="vent-label">배기</div>
                  <div className="vent-speed">0%</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 온습도 그룹 */}
        <div className="panel-group">
          <div className="control-panel">
            <div className="control-panel-header">
              <h3 className="control-panel-title">조리실 온도/습도</h3>
            </div>
            <div className="temp-humidity-container">
              <div className="temp-humidity-item">
                <div className="th-icon">🌡️</div>
                <div className="th-content">
                  <div className="th-label">온도</div>
                  <div className="th-value">{kitchen.temperature.toFixed(1)}<span className="th-unit">°C</span></div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" id="kitchen-temp-progress" style={{ width: `${Math.min(100, (kitchen.temperature / 40) * 100)}%` }}></div>
                </div>
              </div>
              <div className="temp-humidity-item">
                <div className="th-icon">💧</div>
                <div className="th-content">
                  <div className="th-label">습도</div>
                  <div className="th-value">{kitchen.humidity.toFixed(1)}<span className="th-unit">%</span></div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" id="kitchen-hum-progress" style={{ width: `${kitchen.humidity}%` }}></div>
                </div>
              </div>
            </div>
          </div>

          <div className="control-panel">
            <div className="control-panel-header">
              <h3 className="control-panel-title">세척실 온도/습도</h3>
            </div>
            <div className="temp-humidity-container">
              <div className="temp-humidity-item">
                <div className="th-icon">🌡️</div>
                <div className="th-content">
                  <div className="th-label">온도</div>
                  <div className="th-value">{washing.temperature.toFixed(1)}<span className="th-unit">°C</span></div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" id="washing-temp-progress" style={{ width: `${Math.min(100, (washing.temperature / 40) * 100)}%` }}></div>
                </div>
              </div>
              <div className="temp-humidity-item">
                <div className="th-icon">💧</div>
                <div className="th-content">
                  <div className="th-label">습도</div>
                  <div className="th-value">{washing.humidity.toFixed(1)}<span className="th-unit">%</span></div>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" id="washing-hum-progress" style={{ width: `${washing.humidity}%` }}></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 조리실/세척실 측정소 위치 맵 */}
        <div className="control-panel kitchen-map-panel">
          <div className="control-panel-header">
            <h3 className="control-panel-title">측정소 위치 맵</h3>
          </div>
          <div 
            className="kitchen-map-container"
            onClick={() => setIsMapPopupOpen(true)}
            style={{ 
              cursor: 'pointer', 
              position: 'relative',
              userSelect: 'none' // 텍스트 선택 방지
            }}
          >
            <img 
              src="/중앙여중.png" 
              alt="조리실/세척실 측정소 위치 맵" 
              className="kitchen-map-image"
            />
            
            {/* 조리실 센서 위치 표시 버튼 (왼쪽) */}
            <div 
              className={`plc-status-button sensor-marker ${kitchenConnected ? 'connected' : 'disconnected'}`}
              style={{
                position: 'absolute',
                top: '55%',
                left: '41%',
                transform: 'translate(-50%, -50%)',
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                backgroundColor: kitchenConnected ? '#4ade80' : '#ef4444',
                border: '2px solid white',
                boxShadow: kitchenConnected 
                  ? '0 0 12px rgba(74, 222, 128, 0.8), 0 0 20px rgba(74, 222, 128, 0.5)'
                  : '0 0 12px rgba(239, 68, 68, 0.8), 0 0 20px rgba(239, 68, 68, 0.5)',
                zIndex: 10,
                animation: kitchenConnected ? 'plcPulseGreen 1.5s infinite' : 'none',
                cursor: 'pointer'
              }}
              title={kitchenConnected ? '조리실 PLC 연결 (정상)' : '조리실 PLC 연결 끊김'}
            />
            
            {/* 세척실 센서 위치 표시 버튼 (오른쪽) */}
            <div 
              className={`plc-status-button sensor-marker ${washingConnected ? 'connected' : 'disconnected'}`}
              style={{
                position: 'absolute',
                top: '65%',
                left: '73%',
                transform: 'translate(-50%, -50%)',
                width: '22px',
                height: '22px',
                borderRadius: '50%',
                backgroundColor: washingConnected ? '#4ade80' : '#ef4444',
                border: '2px solid white',
                boxShadow: washingConnected 
                  ? '0 0 12px rgba(74, 222, 128, 0.8), 0 0 20px rgba(74, 222, 128, 0.5)'
                  : '0 0 12px rgba(239, 68, 68, 0.8), 0 0 20px rgba(239, 68, 68, 0.5)',
                zIndex: 10,
                animation: washingConnected ? 'plcPulseGreen 1.5s infinite' : 'none',
                cursor: 'pointer'
              }}
              title={washingConnected ? '세척실 PLC 연결 (정상)' : '세척실 PLC 연결 끊김'}
            />
          </div>
        </div>
      </div>

      {/* 맵 팝업 모달 */}
      {isMapPopupOpen && (
        <div 
          className="map-popup-overlay"
          onClick={() => setIsMapPopupOpen(false)}
        >
          <div 
            className="map-popup-container" 
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              className="map-popup-close"
              onClick={() => setIsMapPopupOpen(false)}
            >
              ✕
            </button>
            
            <div className="map-popup-main">
              {/* 메인 맵 이미지 */}
              <div className="map-popup-content">
                <img 
                  src="/중앙여중.png" 
                  alt="조리실/세척실 측정소 위치 맵 확대" 
                  className="map-popup-image"
                />
                {/* 조리실 센서 위치 표시 버튼 (팝업 - 왼쪽) */}
                <div 
                  className={`plc-status-button sensor-marker sensor-marker-popup ${kitchenConnected ? 'connected' : 'disconnected'}`}
                  style={{
                    position: 'absolute',
                    top: '60%',
                    left: '40%',
                    transform: 'translate(-50%, -50%)',
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    backgroundColor: kitchenConnected ? '#4ade80' : '#ef4444',
                    border: '3px solid white',
                    boxShadow: kitchenConnected 
                      ? '0 0 18px rgba(74, 222, 128, 0.9), 0 0 35px rgba(74, 222, 128, 0.6)'
                      : '0 0 18px rgba(239, 68, 68, 0.9), 0 0 35px rgba(239, 68, 68, 0.6)',
                    zIndex: 10,
                    animation: kitchenConnected ? 'plcPulseGreen 1.5s infinite' : 'none',
                    cursor: 'default'
                  }}
                  title={kitchenConnected ? '조리실 PLC 연결 (정상)' : '조리실 PLC 연결 끊김'}
                />
                
                {/* 세척실 센서 위치 표시 버튼 (팝업 - 오른쪽) */}
                <div 
                  className={`plc-status-button sensor-marker sensor-marker-popup ${washingConnected ? 'connected' : 'disconnected'}`}
                  style={{
                    position: 'absolute',
                    top: '67%',
                    left: '73%',
                    transform: 'translate(-50%, -50%)',
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    backgroundColor: washingConnected ? '#4ade80' : '#ef4444',
                    border: '3px solid white',
                    boxShadow: washingConnected 
                      ? '0 0 18px rgba(74, 222, 128, 0.9), 0 0 35px rgba(74, 222, 128, 0.6)'
                      : '0 0 18px rgba(239, 68, 68, 0.9), 0 0 35px rgba(239, 68, 68, 0.6)',
                    zIndex: 10,
                    animation: washingConnected ? 'plcPulseGreen 1.5s infinite' : 'none',
                    cursor: 'default'
                  }}
                  title={washingConnected ? '세척실 PLC 연결 (정상)' : '세척실 PLC 연결 끊김'}
                />
              </div>
              
              {/* 오른쪽 추가 이미지 리스트 */}
              <div className="map-popup-sidebar">
                <h3 className="sidebar-title">관련 도면</h3>
                {additionalImages.map((img, index) => (
                  <div 
                    key={index}
                    className="sidebar-image-item"
                    onClick={() => setFullscreenImage({ isOpen: true, src: img.src, title: img.title })}
                  >
                    <img src={img.src} alt={img.title} className="sidebar-thumbnail" />
                    <div className="sidebar-image-title">{img.title}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 전체 화면 이미지 뷰어 */}
      {fullscreenImage.isOpen && (
        <div 
          className="fullscreen-image-overlay"
          onClick={closeFullscreenImage}
        >
          <button 
            className="fullscreen-image-close"
            onClick={closeFullscreenImage}
          >
            ✕
          </button>
          <div className="fullscreen-image-title">{fullscreenImage.title}</div>
          <div className="fullscreen-image-hint">
            🔍 마우스 휠로 확대/축소 | 드래그로 이동 | 더블클릭으로 초기화
          </div>
          <div 
            className="fullscreen-image-container"
            onWheel={handleFullscreenWheel}
            onMouseDown={handleFullscreenMouseDown}
            onMouseMove={handleFullscreenMouseMove}
            onMouseUp={handleFullscreenMouseUp}
            onMouseLeave={handleFullscreenMouseUp}
            onTouchStart={handleFullscreenTouchStart}
            onTouchMove={handleFullscreenTouchMove}
            onTouchEnd={handleFullscreenTouchEnd}
            onDoubleClick={handleFullscreenDoubleClick}
            onClick={(e) => e.stopPropagation()}
            style={{
              cursor: fullscreenDragging ? 'grabbing' : 'grab',
              touchAction: 'none'
            }}
          >
            <img 
              src={fullscreenImage.src} 
              alt={fullscreenImage.title}
              className="fullscreen-image"
              style={{
                transform: `scale(${fullscreenScale}) translate(${fullscreenPosition.x / fullscreenScale}px, ${fullscreenPosition.y / fullscreenScale}px)`,
                transition: fullscreenDragging ? 'none' : 'transform 0.1s ease-out'
              }}
              draggable={false}
            />
          </div>
        </div>
      )}

      {/* 차트 모달 */}
      <MetricChartModal
        isOpen={chartModal.isOpen}
        onClose={closeChart}
        metric={chartModal.metric}
        metricName={chartModal.metricName}
        room={chartModal.room}
        hours={24}
      />
    </div>
  );
}
