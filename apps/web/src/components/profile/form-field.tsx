import { useId, type ReactNode } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';

const CONTROL_CLASS =
  'w-full rounded-lg border border-border-subtle bg-surface-base px-3 py-2 text-sm text-content-primary placeholder:text-content-muted';

interface FormFieldProps {
  readonly label: string;
  readonly field: UseFormRegisterReturn;
  readonly error?: string | undefined;
  readonly placeholder?: string;
  readonly type?: 'text' | 'email' | 'month';
  readonly rows?: number;
}

/**
 * Campo rotulado com erro acessivel: o `label` aponta para o controle pelo id,
 * e a mensagem vira `aria-describedby` em vez de texto solto ao lado.
 */
export function FormField({
  label,
  field,
  error,
  placeholder,
  type = 'text',
  rows,
}: FormFieldProps): ReactNode {
  const id = useId();
  const errorId = `${id}-error`;
  const describedBy = error === undefined ? undefined : errorId;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-content-muted">
        {label}
      </label>
      {rows === undefined ? (
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          {...field}
          className={CONTROL_CLASS}
        />
      ) : (
        <textarea
          id={id}
          rows={rows}
          placeholder={placeholder}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          {...field}
          className={CONTROL_CLASS}
        />
      )}
      {error !== undefined && (
        <p id={errorId} role="alert" className="mt-1 text-xs text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
