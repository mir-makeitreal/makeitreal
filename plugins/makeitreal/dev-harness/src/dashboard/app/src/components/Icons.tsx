import React from 'react';

type IconProps = React.HTMLAttributes<HTMLSpanElement> & {
  size?: 'sm' | 'md' | 'lg';
};

function cls(extra: string | undefined, size: IconProps['size']) {
  const sizeCls = size === 'sm' ? ' icon-svg--sm' : size === 'lg' ? ' icon-svg--lg' : '';
  return `${extra ?? ''}${sizeCls}`.trim();
}

export function IconCheck(props: IconProps) {
  const { className, size, ...rest } = props;
  return <span className={`icon-check ${cls(className, size)}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconX(props: IconProps) {
  const { className, size, ...rest } = props;
  return <span className={`icon-x ${cls(className, size)}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconDot(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-dot ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconRing(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-ring ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconChevronRight(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-chevron-right ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconChevronDown(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-chevron-down ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconMenu(props: IconProps) {
  const { className, ...rest } = props;
  return (
    <span className={`icon-menu ${className ?? ''}`.trim()} aria-hidden="true" {...rest}>
      <i />
    </span>
  );
}

export function IconFolder(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-folder ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconFile(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-file ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconEye(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-eye ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconBolt(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-bolt ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconSearch(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-search ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconBlock(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-block ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconClock(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-clock ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconClipboard(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-clipboard ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}

export function IconWarn(props: IconProps) {
  const { className, ...rest } = props;
  return <span className={`icon-warn ${className ?? ''}`.trim()} aria-hidden="true" {...rest} />;
}
