import { TowLog } from '../types';
import { getTrajectory } from '../constants';

export interface RenderedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// Render the facility map + this mission's GPS trajectory to a JPEG (bytes).
export const renderTrajectoryJpeg = (log: TowLog): Promise<RenderedImage> =>
  new Promise((resolve, reject) => {
    const W = 1000;
    const H = 563;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('no canvas context'));
      return;
    }

    const img = new Image();
    img.onload = () => {
      ctx.fillStyle = '#1A1D23';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(img, 0, 0, W, H);

      const pts = getTrajectory(log.details?.path).map((p) => ({ x: (p.x / 100) * W, y: (p.y / 100) * H }));
      if (pts.length > 1) {
        ctx.save();
        ctx.strokeStyle = '#00D1FF';
        ctx.lineWidth = 5;
        ctx.lineJoin = 'miter';
        ctx.lineCap = 'round';
        ctx.shadowColor = 'rgba(0,209,255,0.7)';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.restore();

        const o = pts[0];
        ctx.fillStyle = '#00D1FF';
        ctx.beginPath();
        ctx.arc(o.x, o.y, 5, 0, Math.PI * 2);
        ctx.fill();

        const e = pts[pts.length - 1];
        ctx.fillStyle = 'rgba(0,123,255,0.3)';
        ctx.beginPath();
        ctx.arc(e.x, e.y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#007BFF';
        ctx.strokeStyle = '#00D1FF';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(e.x, e.y - 6);
        ctx.lineTo(e.x + 5, e.y + 5);
        ctx.lineTo(e.x, e.y + 2);
        ctx.lineTo(e.x - 5, e.y + 5);
        ctx.closePath();
        ctx.fill();
      }

      const pill = (x: number, y: number, dot: string, text: string) => {
        ctx.font = 'bold 15px sans-serif';
        const w = ctx.measureText(text).width + 42;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        roundRect(ctx, x, y, w, 30, 6);
        ctx.fill();
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(x + 16, y + 15, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 28, y + 16);
      };
      pill(16, 16, '#00D1FF', 'ROBOT ACTIVE');
      pill(16, 54, '#007BFF', `${log.tailNumber} POS`);

      const caption = (log.details?.path ?? '').toUpperCase();
      if (caption) {
        ctx.font = 'bold 15px sans-serif';
        const w = ctx.measureText(caption).width + 24;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        roundRect(ctx, W - 16 - w, H - 16 - 30, w, 30, 6);
        ctx.fill();
        ctx.fillStyle = '#00D1FF';
        ctx.textBaseline = 'middle';
        ctx.fillText(caption, W - 16 - w + 12, H - 16 - 15);
      }

      const b64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve({ bytes, width: W, height: H });
    };
    img.onerror = () => reject(new Error('facility map failed to load'));
    img.src = `${import.meta.env.BASE_URL}facility-map.jpg`;
  });
