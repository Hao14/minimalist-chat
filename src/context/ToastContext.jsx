// Replaces the legacy global window.showToast with a React context.
// Usage: const { showToast } = useToast();  showToast('message', isError)
import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null); // { message, isError }

  const showToast = useCallback((message, isError = true) => {
    setToast({ message, isError });
  }, []);

  const hideToast = useCallback(() => setToast(null), []);

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toast && (
        <div id="brutalist-toast">
          <span id="toast-icon">{toast.isError ? '⚠️' : '✅'}</span>
          <span id="toast-message">{toast.message}</span>
          <button id="toast-close" onClick={hideToast}>✖</button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
