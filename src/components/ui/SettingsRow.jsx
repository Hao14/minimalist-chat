import './uiPrimitives.css';

function joinClassNames(...values) {
  return values.filter(Boolean).join(' ');
}

export function SettingsRow({
  as: Component = 'div',
  children,
  className = '',
  description,
  leading,
  title,
  tone = 'default',
  trailing,
  type,
  value,
  ...props
}) {
  const componentProps = {
    ...props,
    className: joinClassNames(
      'ui-settings-row',
      tone === 'danger' ? 'ui-settings-row--danger' : '',
      className,
    ),
  };

  if (Component === 'button') {
    componentProps.type = type || 'button';
  }

  if (children !== undefined) {
    return <Component {...componentProps}>{children}</Component>;
  }

  return (
    <Component {...componentProps}>
      {leading}
      <span className="ui-settings-row__copy">
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      {value ? <span className="ui-settings-row__value">{value}</span> : null}
      {trailing}
    </Component>
  );
}
