import { FridgeState } from '../types';
import { theme } from '../theme';

interface FridgePanelProps {
  type: '냉장' | '냉동';
  fridgeState: FridgeState;
}

export function FridgePanel({ type, fridgeState }: FridgePanelProps) {
  const statusColors = {
    normal: { bg: '#f0f9ff', border: '#3b82f6', text: '#1e40af' },
    warning: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
    alarm: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' }
  }[fridgeState.status];

  const statusLabel = {
    normal: '정상',
    warning: '주의',
    alarm: '알람'
  }[fridgeState.status];

  return (
    <div
      style={{
        backgroundColor: statusColors.bg,
        border: `2px solid ${statusColors.border}`,
        borderRadius: theme.borderRadius.md,
        padding: theme.spacing.md,
        display: 'flex',
        flexDirection: 'column',
        gap: theme.spacing.sm,
        minWidth: '200px'
      }}
    >
      <h3 style={{ margin: 0, fontSize: '1.1rem', color: theme.colors.text.primary }}>
        {type}
      </h3>
      
      <div style={{ fontSize: '2rem', fontWeight: 'bold', color: statusColors.text }}>
        {fridgeState.temp.toFixed(1)}°C
      </div>

      <div
        style={{
          padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          backgroundColor: statusColors.border,
          color: 'white',
          borderRadius: theme.borderRadius.sm,
          fontSize: '0.75rem',
          fontWeight: 'bold',
          textAlign: 'center'
        }}
      >
        {statusLabel}
      </div>

      {fridgeState.alarm && (
        <div
          style={{
            padding: theme.spacing.sm,
            backgroundColor: theme.colors.banner.danger,
            border: `1px solid ${theme.colors.banner.dangerBorder}`,
            borderRadius: theme.borderRadius.sm,
            color: theme.colors.banner.dangerText,
            fontSize: '0.875rem',
            fontWeight: 'bold'
          }}
        >
          ⚠️ {fridgeState.alarm}
        </div>
      )}
    </div>
  );
}

