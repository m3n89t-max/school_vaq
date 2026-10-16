import { useEffect, useState } from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { MetricHistory } from '../types';

interface MiniChartProps {
  room: string;
  metric: string;
}

export function MiniChart({ room, metric }: MiniChartProps) {
  const [data, setData] = useState<MetricHistory[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const response = await fetch(
          `http://${window.location.hostname}:3001/api/metrics/history/${room}/${metric}?minutes=30`
        );
        const result = await response.json();
        setData(result.data || []);
      } catch (error) {
        console.error('히스토리 조회 실패:', error);
      }
    };

    fetchHistory();
    const interval = setInterval(fetchHistory, 10000); // 10초마다 갱신
    return () => clearInterval(interval);
  }, [room, metric]);

  const chartData = data.map((item) => ({
    time: new Date(item.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
    value: item.value
  }));

  return (
    <ResponsiveContainer width="100%" height={60}>
      <LineChart data={chartData}>
        <Line
          type="monotone"
          dataKey="value"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

