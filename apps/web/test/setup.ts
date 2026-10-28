import '@testing-library/jest-dom/vitest';

import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

const CHART_WIDTH = 800;
const CHART_HEIGHT = 300;

/**
 * O jsdom nao calcula layout: todo elemento mede 0x0 e nao tem ResizeObserver.
 * Sem isso o ResponsiveContainer do Recharts desiste de renderizar e os testes
 * de grafico passariam a verificar uma caixa vazia.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

for (const [property, value] of [
  ['offsetWidth', CHART_WIDTH],
  ['offsetHeight', CHART_HEIGHT],
  ['clientWidth', CHART_WIDTH],
  ['clientHeight', CHART_HEIGHT],
] as const) {
  Object.defineProperty(HTMLElement.prototype, property, {
    configurable: true,
    value,
  });
}

HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
  return {
    width: CHART_WIDTH,
    height: CHART_HEIGHT,
    top: 0,
    left: 0,
    right: CHART_WIDTH,
    bottom: CHART_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
