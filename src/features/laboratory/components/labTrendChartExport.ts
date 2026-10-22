import { getTodayISO } from '@/utils/dateCoreUtils';
const EXPORT_SCALE = 2;
const EXPORT_PADDING = 0;
const FALLBACK_WIDTH = 960;
const FALLBACK_HEIGHT = 640;

const canvasToBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('No se pudo generar el archivo PNG de tendencias.'));
    }, 'image/png');
  });

const drawRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const safeRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
};

const buildRelativeRect = (element: Element, containerRect: DOMRect) => {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - containerRect.left + EXPORT_PADDING,
    y: rect.top - containerRect.top + EXPORT_PADDING,
    width: rect.width,
    height: rect.height,
  };
};

const drawTrendCardChrome = (
  context: CanvasRenderingContext2D,
  card: HTMLElement,
  containerRect: DOMRect
) => {
  const rect = buildRelativeRect(card, containerRect);
  context.fillStyle = '#ffffff';
  context.strokeStyle = '#e2e8f0';
  context.lineWidth = 1;
  drawRoundedRect(context, rect.x, rect.y, rect.width, rect.height, 12);
  context.fill();
  context.stroke();
};

const drawVisibleText = (
  context: CanvasRenderingContext2D,
  card: HTMLElement,
  containerRect: DOMRect
) => {
  const textElements = Array.from(card.querySelectorAll<HTMLElement>('h4, span')).filter(
    element => {
      const text = element.textContent?.trim();
      const rect = element.getBoundingClientRect();
      return Boolean(text) && rect.width > 0 && rect.height > 0;
    }
  );

  for (const element of textElements) {
    const text = element.textContent?.trim();
    if (!text) {
      continue;
    }

    const style = window.getComputedStyle(element);
    const rect = buildRelativeRect(element, containerRect);
    const fontSize = Number.parseFloat(style.fontSize || '11') || 11;
    const fontWeight = Number.parseInt(style.fontWeight || '500', 10) || 500;

    context.font = `${fontWeight} ${fontSize}px Inter, Arial, sans-serif`;
    context.fillStyle = style.color && !style.color.includes('oklch') ? style.color : '#334155';
    context.textBaseline = 'top';
    context.fillText(text, rect.x, rect.y, Math.max(rect.width + 8, 40));
  }
};

const serializeSvg = (svg: SVGSVGElement): string => {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(rect.width, Number.parseFloat(svg.getAttribute('width') || '0'), 1);
  const height = Math.max(rect.height, Number.parseFloat(svg.getAttribute('height') || '0'), 1);

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent =
    'text{font-family:Inter,Arial,sans-serif}.recharts-cartesian-grid line{stroke:#e2e8f0}';
  clone.insertBefore(style, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
};

const loadSvgImage = (
  svg: SVGSVGElement
): Promise<{ image: HTMLImageElement; revoke: () => void }> =>
  new Promise((resolve, reject) => {
    const blob = new Blob([serializeSvg(svg)], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const image = new Image();

    image.onload = () => resolve({ image, revoke: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo preparar el grafico para exportar.'));
    };
    image.src = url;
  });

const drawSvgElements = async (
  context: CanvasRenderingContext2D,
  container: HTMLDivElement,
  containerRect: DOMRect
) => {
  const svgElements = Array.from(container.querySelectorAll<SVGSVGElement>('svg')).filter(svg => {
    const rect = svg.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  });

  for (const svg of svgElements) {
    const rect = buildRelativeRect(svg, containerRect);
    const { image, revoke } = await loadSvgImage(svg);
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    revoke();
  }
};

export const exportChartsAsPng = async (container: HTMLDivElement): Promise<void> => {
  const containerRect = container.getBoundingClientRect();
  const width = Math.ceil(Math.max(container.scrollWidth, containerRect.width, FALLBACK_WIDTH));
  const height = Math.ceil(Math.max(container.scrollHeight, containerRect.height, FALLBACK_HEIGHT));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * EXPORT_SCALE);
  canvas.height = Math.ceil(height * EXPORT_SCALE);

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('No se pudo preparar el lienzo de exportacion.');
  }

  context.scale(EXPORT_SCALE, EXPORT_SCALE);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);

  const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-lab-trend-card]'));
  for (const card of cards) {
    drawTrendCardChrome(context, card, containerRect);
  }

  await drawSvgElements(context, container, containerRect);

  for (const card of cards) {
    drawVisibleText(context, card, containerRect);
  }

  const blob = await canvasToBlob(canvas);
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `laboratorio_tendencias_${getTodayISO()}.png`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
};
