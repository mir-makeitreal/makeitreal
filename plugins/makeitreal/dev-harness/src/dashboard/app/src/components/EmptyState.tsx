import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message?: string;
  variant?: 'default' | 'inline' | 'compact';
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  icon,
  title,
  message,
  variant = 'default',
  action,
}: EmptyStateProps) {
  return (
    <div className={`empty-state empty-state--${variant}`} role="status">
      <span className="empty-state__icon" aria-hidden="true">
        {icon ?? <span className="icon-ring" />}
      </span>
      <div>
        {title && <div className="empty-state__title">{title}</div>}
        {message && <div className="empty-state__message">{message}</div>}
      </div>
      {action && (
        <div className="empty-state__action">
          <button
            type="button"
            className="empty-state__action-btn"
            onClick={action.onClick}
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  );
}
