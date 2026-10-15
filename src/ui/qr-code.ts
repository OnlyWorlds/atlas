/**
 * A link as a QR code (#341): dark modules as one path, a quiet zone of four,
 * black on white so a phone can scan it in either theme. Lantern draws its
 * invite's code the same way (`tools/lantern/src/views/invite.ts`). The
 * encoder loads only when a code is drawn.
 */

const SVG = 'http://www.w3.org/2000/svg';

export async function qrCodeSvg(text: string): Promise<SVGSVGElement> {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + 8;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'atlas-invite-qr-code');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'The invite link as a QR code');
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#fff');
  const ink = document.createElementNS(SVG, 'path');
  ink.setAttribute('d', d);
  ink.setAttribute('fill', '#000');
  svg.append(bg, ink);
  return svg;
}
