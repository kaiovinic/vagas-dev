import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';

import { App } from '@/app';
import { createQueryClient } from '@/lib/query-client';
import '@/styles/global.css';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('Elemento #root nao encontrado no index.html');
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
