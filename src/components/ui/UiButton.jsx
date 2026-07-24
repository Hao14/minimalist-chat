import './uiPrimitives.css';

function joinClassNames(...values) {
  return values.filter(Boolean).join(' ');
}

export function UiButton({
  as: Component = 'button',
  children,
  className = '',
  iconOnly = false,
  size = 'default',
  title,
  tooltip,
  type,
  variant = 'primary',
  ...props
}) {
  const componentProps = {
    ...props,
    className: joinClassNames(
      'ui-button',
      `ui-button--${variant}`,
      `ui-button--${size}`,
      iconOnly ? 'ui-icon-button' : '',
      className,
    ),
    'data-ui-tooltip': tooltip || undefined,
    title: title || tooltip || undefined,
  };

  if (Component === 'button') {
    componentProps.type = type || 'button';
  }

  return <Component {...componentProps}>{children}</Component>;
}

export function UiIconButton({
  children,
  label,
  tooltip = label,
  ...props
}) {
  return (
    <UiButton
      {...props}
      aria-label={props['aria-label'] || label}
      iconOnly
      tooltip={tooltip}
    >
      {children}
    </UiButton>
  );
}

export function UiSeparator({ className = '', ...props }) {
  return (
    <div
      {...props}
      className={joinClassNames('ui-separator', className)}
      role={props.role || 'separator'}
    />
  );
}
