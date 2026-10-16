import { useEffect, useState, useMemo, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface ChartData {
  timestamp: string;
  value: number;
  fullDate?: Date;
  dateLabel?: string | null;
}

interface MetricChartModalProps {
  isOpen: boolean;
  onClose: () => void;
  metric: string;
  metricName: string;
  room?: string;
  hours?: number;
}

const METRIC_INFO: Record<string, { unit: string; color: string }> = {
  co2: { unit: 'ppm', color: '#8884d8' },
  pm25: { unit: 'μg/m³', color: '#82ca9d' },
  pm10: { unit: 'μg/m³', color: '#ffc658' },
  tvoc: { unit: 'ppb', color: '#ff7300' },
  formaldehyde: { unit: 'μg/m³', color: '#ff6b6b' },
  co: { unit: 'ppm', color: '#fa5252' },
  temperature: { unit: '°C', color: '#0088fe' },
  humidity: { unit: '%', color: '#00c49f' },
};

export default function MetricChartModal({ isOpen, onClose, metric, metricName, room = 'kitchen', hours: initialHours = 24 }: MetricChartModalProps) {
  const [data, setData] = useState<ChartData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHours, setSelectedHours] = useState(initialHours);
  const [viewRange, setViewRange] = useState<{ startIndex: number; endIndex: number } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0); // 강제 새로고침용
  
  // 확대/축소 상태
  const [zoomLevel, setZoomLevel] = useState(1.0); // 1.0 = 100%
  
  // 드래그 상태
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartIndex, setDragStartIndex] = useState(0);

  // 드래그 시작
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (!viewRange || data.length === 0) return;
    
    setIsDragging(true);
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    setDragStartX(clientX);
    setDragStartIndex(viewRange.startIndex);
  };

  // 드래그 중
  const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || !viewRange || data.length === 0) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const deltaX = dragStartX - clientX; // 반대 방향으로 이동
    
    // 픽셀당 데이터 포인트 이동량 계산 (터치 환경에 최적화)
    const chartWidth = 800; // 대략적인 차트 너비
    const visibleRange = viewRange.endIndex - viewRange.startIndex;
    const sensitivity = 0.7; // 드래그 감도 (0.5 = 느림, 1.0 = 빠름)
    const moveAmount = Math.floor((deltaX / chartWidth) * visibleRange * sensitivity);
    
    let newStart = dragStartIndex + moveAmount;
    let newEnd = newStart + visibleRange;
    
    // 범위 제한
    if (newStart < 0) {
      newStart = 0;
      newEnd = visibleRange;
    }
    if (newEnd >= data.length) {
      newEnd = data.length - 1;
      newStart = newEnd - visibleRange;
    }
    
    setViewRange({ startIndex: newStart, endIndex: newEnd });
  };

  // 드래그 종료
  const handleDragEnd = () => {
    setIsDragging(false);
  };

  // 확대/축소 핸들러
  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.2, 3.0)); // 최대 300%
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 0.2, 0.5)); // 최소 50%
  };

  const handleZoomReset = () => {
    setZoomLevel(1.0);
  };

  // 마우스 휠로 확대/축소
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1; // 휠 아래로 = 축소, 위로 = 확대
    setZoomLevel(prev => Math.min(Math.max(prev + delta, 0.5), 3.0));
  };

  useEffect(() => {
    if (!isOpen) return;

    let retryCount = 0;
    const maxRetries = 3;
    let isCancelled = false;

    const fetchData = async () => {
      if (isCancelled) return;
      
      // 재시도 중에는 로딩 표시 안 함 (깜빡임 방지)
      if (retryCount === 0) {
        setLoading(true);
      }
      setError(null);

      try {
        // 타임아웃 설정 (30초)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(
          `http://localhost:8000/api/history?metric=${metric}&hours=${selectedHours}&room=${room}`,
          { signal: controller.signal }
        );
        
        clearTimeout(timeoutId);

        if (isCancelled) return;

        // HTTP 상태 코드 확인
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();

        if (result.ok) {
          // 데이터가 없는 경우 처리
          if (!result.data || result.data.length === 0) {
            setError('표시할 데이터가 없습니다. 데이터 수집 중...');
            setLoading(false);
            return;
          }

          // 데이터 포인트 수 제한 (메모리 절약 및 성능 최적화)
          const maxDataPoints = 2000;  // 3000→2000으로 감소
          let sampledData = result.data;
          
          if (result.data.length > maxDataPoints) {
            // 데이터를 균등하게 샘플링
            const step = Math.ceil(result.data.length / maxDataPoints);
            sampledData = result.data.filter((_: any, index: number) => index % step === 0);
            console.log(`📊 데이터 샘플링: ${result.data.length} → ${sampledData.length} 포인트`);
          }

          // 데이터 포맷팅 (시간과 날짜 분리)
          const formattedData = sampledData.map((item: ChartData, index: number) => {
            const date = new Date(item.timestamp);
            const prevDate = index > 0 ? new Date(sampledData[index - 1].timestamp) : null;
            
            // 날짜가 바뀌는 시점인지 확인
            const isNewDay = !prevDate || 
              date.getDate() !== prevDate.getDate() ||
              date.getMonth() !== prevDate.getMonth() ||
              date.getFullYear() !== prevDate.getFullYear();
            
            return {
              timestamp: date.toLocaleTimeString('ko-KR', {
                hour: '2-digit',
                minute: '2-digit',
              }),
              value: item.value,
              fullDate: date,
              dateLabel: isNewDay ? date.toLocaleDateString('ko-KR', {
                month: 'short',
                day: 'numeric',
              }) : null,
            };
          });
          
          if (isCancelled) return;
          
          setData(formattedData);
          
          // 초기 뷰 범위 설정 (최적화)
          if (selectedHours >= 24) {
            const totalPoints = formattedData.length;
            let visibleHours;
            
            // 보여줄 시간 범위 결정
            if (selectedHours === 24) {
              visibleHours = 8; // 1일 데이터 → 최근 8시간 표시 (6→8)
            } else {
              visibleHours = 24; // 7일 데이터 → 최근 1일만 표시
            }
            
            const visibleRatio = visibleHours / selectedHours;
            const visiblePoints = Math.floor(totalPoints * visibleRatio);
            const startIdx = Math.max(0, totalPoints - visiblePoints);
            setViewRange({ startIndex: startIdx, endIndex: totalPoints - 1 });
          } else {
            setViewRange(null); // 6시간은 전체 표시
          }
          
          // 성공 시 재시도 카운터 초기화
          retryCount = 0;
        } else {
          throw new Error(result.error || '데이터를 불러올 수 없습니다.');
        }
      } catch (err: any) {
        if (isCancelled) return;
        
        console.error('Chart data fetch error:', err);
        
        // 재시도 로직
        if (retryCount < maxRetries && err.name !== 'AbortError') {
          retryCount++;
          console.log(`재시도 중... (${retryCount}/${maxRetries})`);
          setTimeout(() => fetchData(), 1000 * retryCount);
          return;
        }
        
        // 최종 에러 메시지
        if (err.name === 'AbortError') {
          setError('데이터 로드 시간이 초과되었습니다. 짧은 시간 범위(6시간)를 선택하세요.');
        } else if (err.message.includes('Failed to fetch')) {
          setError('서버에 연결할 수 없습니다. PLC Bridge가 실행 중인지 확인하세요.');
        } else {
          setError(err.message || '네트워크 오류가 발생했습니다.');
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    // 초기 데이터 로드
    fetchData();

    // 클린업: 컴포넌트 언마운트 시 요청 취소
    return () => {
      isCancelled = true;
    };
    
  }, [isOpen, metric, room, selectedHours, refreshTrigger]);

  const metricInfo = useMemo(() => METRIC_INFO[metric] || { unit: '', color: '#8884d8' }, [metric]);

  // 줌 레벨에 따른 데이터 범위 조정 (useMemo로 최적화)
  const effectiveRange = useMemo(() => {
    if (!viewRange || data.length === 0) return viewRange;
    
    const totalRange = viewRange.endIndex - viewRange.startIndex;
    const zoomedRange = Math.max(10, Math.floor(totalRange / zoomLevel)); // 최소 10개 포인트
    const center = Math.floor((viewRange.startIndex + viewRange.endIndex) / 2);
    
    let newStart = Math.floor(center - zoomedRange / 2);
    let newEnd = Math.floor(center + zoomedRange / 2);
    
    // 범위 제한
    if (newStart < 0) {
      newStart = 0;
      newEnd = Math.min(zoomedRange, data.length - 1);
    }
    if (newEnd >= data.length) {
      newEnd = data.length - 1;
      newStart = Math.max(0, newEnd - zoomedRange);
    }
    
    return { startIndex: newStart, endIndex: newEnd };
  }, [viewRange, data.length, zoomLevel]);

  // 표시할 데이터 범위 계산 (useMemo로 최적화)
  const visibleData = useMemo(() => {
    if (!effectiveRange) return data;
    
    return data.slice(effectiveRange.startIndex, effectiveRange.endIndex + 1).map((item, index, arr) => {
      let shouldShowDate = false;
      
      if (index === 0) {
        shouldShowDate = true;
      } else {
        const prevItem = arr[index - 1];
        if (item.fullDate && prevItem.fullDate) {
          shouldShowDate = 
            item.fullDate.getDate() !== prevItem.fullDate.getDate() ||
            item.fullDate.getMonth() !== prevItem.fullDate.getMonth() ||
            item.fullDate.getFullYear() !== prevItem.fullDate.getFullYear();
        }
      }
      
      return {
        ...item,
        dateLabel: shouldShowDate && item.fullDate ? item.fullDate.toLocaleDateString('ko-KR', {
          month: 'short',
          day: 'numeric',
        }) : null,
      };
    });
  }, [data, effectiveRange]);

  if (!isOpen) return null;

  // 커스텀 X축 틱 (시간 + 날짜)
  const CustomXAxisTick = (props: any) => {
    const { x, y, payload } = props;
    const dataPoint = visibleData.find(d => d.timestamp === payload.value);
    
    return (
      <g transform={`translate(${x},${y})`}>
        {/* 시간 표시 */}
        <text x={0} y={0} dy={16} textAnchor="middle" fill="#ccc" fontSize={13}>
          {payload.value}
        </text>
        {/* 날짜 표시 (날짜가 바뀔 때만) - 24시간마다 */}
        {dataPoint?.dateLabel && (
          <>
            {/* 날짜 배경 */}
            <rect 
              x={-30} 
              y={20} 
              width={60} 
              height={20} 
              fill="rgba(77, 171, 247, 0.15)" 
              rx={4}
            />
            {/* 날짜 텍스트 */}
            <text 
              x={0} 
              y={0} 
              dy={35} 
              textAnchor="middle" 
              fill="#4dabf7" 
              fontSize={13} 
              fontWeight="bold"
            >
              {dataPoint.dateLabel}
            </text>
          </>
        )}
      </g>
    );
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#1a1a2e',
          borderRadius: '12px',
          padding: '30px',
          width: '90%',
          maxWidth: '1200px',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h2 style={{ color: '#fff', margin: '0 0 15px 0', fontSize: '24px', fontWeight: 'bold' }}>
              [{room === 'washing' ? '세척실' : '조리실'}] {metricName} 과거 데이터
            </h2>
            {/* 시간 범위 선택 버튼 */}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              {[6, 24, 24 * 7].map((h) => (
                <button
                  key={h}
                  onClick={() => setSelectedHours(h)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: selectedHours === h ? '#4dabf7' : '#2c3e50',
                    color: '#fff',
                    border: selectedHours === h ? '2px solid #74c0fc' : '1px solid #444',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: selectedHours === h ? 'bold' : 'normal',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (selectedHours !== h) {
                      e.currentTarget.style.backgroundColor = '#34495e';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (selectedHours !== h) {
                      e.currentTarget.style.backgroundColor = '#2c3e50';
                    }
                  }}
                >
                  {h < 24 ? `${h}시간` : h === 24 ? '1일' : h === 24 * 7 ? '7일' : '30일'}
                </button>
              ))}
              
              {/* 확대/축소 버튼 */}
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginLeft: '10px', padding: '4px 8px', backgroundColor: '#1e1e2e', borderRadius: '6px' }}>
                <button
                  onClick={handleZoomOut}
                  style={{
                    padding: '4px 10px',
                    backgroundColor: '#2c3e50',
                    color: '#fff',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold',
                  }}
                  title="축소 (마우스 휠 또는 클릭)"
                >
                  −
                </button>
                <span style={{ 
                  fontSize: '13px', 
                  color: '#aaa', 
                  minWidth: '50px', 
                  textAlign: 'center',
                  fontWeight: 'bold'
                }}>
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  onClick={handleZoomIn}
                  style={{
                    padding: '4px 10px',
                    backgroundColor: '#2c3e50',
                    color: '#fff',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: 'bold',
                  }}
                  title="확대 (마우스 휠 또는 클릭)"
                >
                  +
                </button>
                <button
                  onClick={handleZoomReset}
                  style={{
                    padding: '4px 10px',
                    backgroundColor: '#2c3e50',
                    color: '#fff',
                    border: '1px solid #444',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    marginLeft: '5px',
                  }}
                  title="100%로 리셋"
                >
                  리셋
                </button>
              </div>
              
              {/* 새로고침 버튼 */}
              <button
                onClick={() => setRefreshTrigger(prev => prev + 1)}
                disabled={loading}
                style={{
                  padding: '8px 16px',
                  backgroundColor: loading ? '#6c757d' : '#28a745',
                  color: '#fff',
                  border: loading ? '1px solid #6c757d' : '1px solid #28a745',
                  opacity: loading ? 0.6 : 1,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: 'bold',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onMouseEnter={(e) => {
                  if (!loading) e.currentTarget.style.backgroundColor = '#218838';
                }}
                onMouseLeave={(e) => {
                  if (!loading) e.currentTarget.style.backgroundColor = '#28a745';
                }}
                title="최신 데이터로 새로고침"
              >
                🔄 새로고침
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#fff',
              fontSize: '28px',
              cursor: 'pointer',
              padding: '0 10px',
            }}
          >
            ✕
          </button>
        </div>

        {/* 로딩 */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#fff' }}>
            <p>데이터를 불러오는 중...</p>
          </div>
        )}

        {/* 에러 */}
        {error && !loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#ff6b6b' }}>
            <p>{error}</p>
          </div>
        )}

        {/* 차트 */}
        {!loading && !error && data.length > 0 && (
          <>
            {/* 안내 메시지 */}
            <div style={{ 
              marginBottom: '10px', 
              padding: '10px 15px', 
              backgroundColor: 'rgba(77, 171, 247, 0.1)', 
              borderRadius: '6px',
              border: '1px solid rgba(77, 171, 247, 0.3)',
              color: '#74c0fc',
              fontSize: '14px',
              textAlign: 'center',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <span>
                👆 <strong>조작:</strong> 드래그로 이동 | 마우스 휠로 확대/축소
              </span>
              <span style={{ fontSize: '12px', color: '#aaa' }}>
                현재 표시: {visibleData.length}개 데이터 포인트
              </span>
            </div>
            <div 
              onMouseDown={handleDragStart}
              onMouseMove={handleDragMove}
              onMouseUp={handleDragEnd}
              onMouseLeave={handleDragEnd}
              onTouchStart={handleDragStart}
              onTouchMove={handleDragMove}
              onTouchEnd={handleDragEnd}
              onWheel={handleWheel}
              style={{ 
                cursor: isDragging ? 'grabbing' : 'grab',
                touchAction: 'none', // 터치 스크롤 방지
                userSelect: 'none', // 텍스트 선택 방지
              }}
            >
              <ResponsiveContainer width="100%" height={520}>
              <LineChart data={visibleData} margin={{ top: 5, right: 30, left: 20, bottom: 70 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis 
                dataKey="timestamp" 
                stroke="#aaa"
                tick={<CustomXAxisTick />}
                angle={0}
                interval="preserveStartEnd"
                minTickGap={30}
                height={70}
              />
              <YAxis 
                stroke="#aaa"
                tick={{ fill: '#aaa', fontSize: 12 }}
                label={{ value: metricInfo.unit, angle: -90, position: 'insideLeft', fill: '#aaa' }}
              />
              <Tooltip 
                contentStyle={{ backgroundColor: '#16213e', border: '1px solid #444', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
                itemStyle={{ color: metricInfo.color }}
              />
              <Legend wrapperStyle={{ color: '#fff' }} />
              <Line 
                type="monotone" 
                dataKey="value" 
                name={metricName}
                stroke={metricInfo.color} 
                strokeWidth={3}
                dot={false}
                activeDot={{ r: 8, fill: metricInfo.color, strokeWidth: 2, stroke: '#fff' }}
              />
            </LineChart>
          </ResponsiveContainer>
            </div>
          </>
        )}

        {/* 데이터 없음 */}
        {!loading && !error && data.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px', color: '#aaa' }}>
            <p>표시할 데이터가 없습니다.</p>
          </div>
        )}

        {/* 통계 정보 */}
        {!loading && !error && visibleData.length > 0 && (
          <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-around', color: '#fff' }}>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>최소값</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: metricInfo.color }}>
                {Math.min(...visibleData.map(d => d.value)).toFixed(1)} {metricInfo.unit}
              </p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>평균값</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: metricInfo.color }}>
                {(visibleData.reduce((sum, d) => sum + d.value, 0) / visibleData.length).toFixed(1)} {metricInfo.unit}
              </p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>최대값</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: metricInfo.color }}>
                {Math.max(...visibleData.map(d => d.value)).toFixed(1)} {metricInfo.unit}
              </p>
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#aaa' }}>현재 표시</p>
              <p style={{ margin: 0, fontSize: '20px', fontWeight: 'bold', color: '#fff' }}>
                {visibleData.length}개
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

