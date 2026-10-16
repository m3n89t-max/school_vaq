import { FanState } from '../types';
import { theme } from '../theme';

interface FanPanelProps {
  room: string;
  fanState: FanState;
}

export function FanPanel({ room, fanState }: FanPanelProps) {
  const roomLabel = room === 'kitchen' ? '조리실' : '세척실';

  return (
    <div
      style={{
        backgroundColor: theme.colors.cardBg,
        border: `1px solid #e5e7eb`,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.md
      }}
    >
      <h3 style={{ margin: 0, fontSize: '1.1rem', color: theme.colors.text.primary }}>
        {roomLabel} 팬 제어
      </h3>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: theme.spacing.md }}>
        {/* 급기 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.xs }}>
            <span style={{ color: theme.colors.text.secondary }}>급기</span>
            <span
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                backgroundColor: fanState.supply.on ? '#10b981' : '#6b7280',
                color: 'white',
                borderRadius: theme.borderRadius.sm,
                fontSize: '0.75rem',
                fontWeight: 'bold'
              }}
            >
              {fanState.supply.on ? 'ON' : 'OFF'}
            </span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: theme.colors.text.primary }}>
            {fanState.supply.speed}%
          </div>
        </div>

        {/* 배기 */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.xs }}>
            <span style={{ color: theme.colors.text.secondary }}>배기</span>
            <span
              style={{
                padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
                backgroundColor: fanState.exhaust.on ? '#10b981' : '#6b7280',
                color: 'white',
                borderRadius: theme.borderRadius.sm,
                fontSize: '0.75rem',
                fontWeight: 'bold'
              }}
            >
              {fanState.exhaust.on ? 'ON' : 'OFF'}
            </span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: theme.colors.text.primary }}>
            {fanState.exhaust.speed}%
          </div>
        </div>
      </div>
    </div>
  );
}

