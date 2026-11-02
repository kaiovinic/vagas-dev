import { useEffect, useState, type ReactNode } from 'react';
import { CircleCheck } from 'lucide-react';

export const TOAST_DURATION_MS = 4_000;

interface ToastProps {
  /** Muda a cada sucesso: e o que faz o toast reaparecer na segunda gravacao. */
  readonly token: number;
  readonly message: string;
}

/**
 * Aviso de sucesso que se apaga sozinho. `role="status"` em vez de `alert`: e
 * confirmacao, nao urgencia, entao o leitor de tela anuncia sem interromper o
 * que o usuario esta fazendo.
 */
export function Toast({ token, message }: ToastProps): ReactNode {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (token === 0) {
      return;
    }

    setIsVisible(true);

    const timer = setTimeout(() => setIsVisible(false), TOAST_DURATION_MS);

    return () => clearTimeout(timer);
  }, [token]);

  if (!isVisible) {
    return null;
  }

  return (
    <div
      role="status"
      data-testid="toast"
      className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl border border-positive/40 bg-surface-overlay px-4 py-3 shadow-lg shadow-black/30"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-positive">
        <CircleCheck aria-hidden="true" className="size-4" />
        {message}
      </p>
    </div>
  );
}
