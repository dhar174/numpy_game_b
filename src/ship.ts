const nodes = [.186, .295, .400, .519, .626, .719, .855];
const palette = ['#79edc7', '#98d1fb', '#aff084', '#ffca7d', '#ffb071', '#c7b9fd', '#81eedf'];
const frameSize = 48;
const frameCount = 8;

// Each system shares the same frame size and room-center anchor. Pixel points
// trace power cells, a radar sweep, growth, containment, cargo, a drone, and a route.
const routes: [number, number][][] = [
  [[8, 31], [8, 22], [14, 22], [14, 31], [20, 31], [20, 16], [26, 16], [26, 31], [32, 31], [32, 10], [38, 10], [38, 31]],
  [[24, 34], [9, 22], [15, 15], [24, 12], [33, 15], [39, 22], [24, 34], [24, 18]],
  [[24, 38], [24, 25], [13, 22], [8, 14], [20, 14], [24, 25], [28, 18], [39, 12], [36, 22], [24, 25], [24, 8]],
  [[12, 12], [36, 12], [36, 36], [12, 36], [12, 12], [24, 12], [24, 36], [24, 24], [34, 24], [14, 24]],
  [[8, 33], [18, 33], [18, 24], [8, 24], [8, 33], [24, 33], [24, 18], [34, 18], [34, 33], [40, 33], [40, 13]],
  [[6, 29], [15, 29], [21, 20], [16, 16], [24, 16], [31, 16], [27, 20], [33, 29], [42, 29], [34, 34], [14, 34], [6, 29]],
  [[6, 38], [16, 30], [20, 30], [25, 18], [31, 18], [41, 7], [40, 14], [34, 8], [41, 7]],
];

function makeRepairStrip(index: number) {
  const strip = document.createElement('canvas');
  strip.width = frameSize * frameCount;
  strip.height = frameSize;
  const ctx = strip.getContext('2d')!;
  const route = routes[index];
  for (let frame = 0; frame < frameCount; frame++) {
    const origin = frame * frameSize;
    ctx.globalAlpha = frame < 5 ? .9 : (frameCount - frame) / 4;
    ctx.fillStyle = palette[index];
    const limit = Math.ceil(((frame + 1) / 6) * (route.length - 1));
    for (let segment = 0; segment < Math.min(route.length - 1, limit); segment++) {
      const [x, y] = route[segment];
      const [tx, ty] = route[segment + 1];
      const count = Math.max(Math.abs(tx - x), Math.abs(ty - y));
      for (let step = 0; step <= count; step += 2) {
        ctx.fillRect(origin + Math.round(x + (tx - x) * step / count),
          Math.round(y + (ty - y) * step / count), 2, 2);
      }
    }
    ctx.fillRect(origin + 4 + frame, 42, 2, 2);
    ctx.fillRect(origin + 42 - frame, 4, 2, 2);
  }
  return strip;
}

export class ShipView {
  #context: CanvasRenderingContext2D;
  #art = new Image();
  #strips = new Map<number, HTMLCanvasElement>();
  #restored: Set<number> = new Set();
  #room = 0;
  #repair: {index: number; start: number} | null = null;
  #frame = 0;
  #reduced = false;
  #drawCount = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.#context = canvas.getContext('2d')!;
    this.#art.fetchPriority = 'low';
    this.#art.decoding = 'async';
    this.#art.onload = () => this.draw();
    this.#art.src = new URL('ship-cutaway.webp', document.baseURI).href;
    new ResizeObserver(() => this.draw()).observe(canvas);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        cancelAnimationFrame(this.#frame);
        this.#frame = 0;
        this.#repair = null;
      } else {
        this.draw();
      }
    });
  }

  get drawCount() { return this.#drawCount; }

  update(room: number, restored: number[], reduced: boolean) {
    this.#room = room;
    this.#restored = new Set(restored);
    this.#reduced = reduced;
    if (reduced) this.#repair = null;
    this.draw();
  }

  repair(index: number) {
    if (this.#reduced || document.hidden) return;
    if (!this.#strips.has(index)) this.#strips.set(index, makeRepairStrip(index));
    this.#repair = {index, start: performance.now()};
    this.#tick();
  }

  advance(ms: number) {
    if (this.#repair) this.#repair.start -= Math.max(0, ms);
    this.draw();
  }

  #tick = () => {
    if (this.#frame || !this.#repair || !this.canvas.getClientRects().length || document.hidden) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      this.draw();
      this.#tick();
    });
  };

  draw() {
    const {width, height} = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    const w = Math.ceil(width / 1.6);
    const h = Math.ceil(height / 1.6);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    const ctx = this.#context;
    this.#drawCount++;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#080f19';
    ctx.fillRect(0, 0, w, h);

    let imageX = 0;
    let imageY = 0;
    let imageWidth = w;
    let imageHeight = h;
    if (this.#art.naturalWidth) {
      const scale = Math.min(w / this.#art.width, h / this.#art.height);
      const dw = this.#art.width * scale;
      const dh = this.#art.height * scale;
      imageX = Math.round((w - dw) / 2);
      imageY = Math.round((h - dh) / 2);
      imageWidth = dw;
      imageHeight = dh;
      ctx.drawImage(this.#art, imageX, imageY, dw, dh);
      for (const [index, offset] of nodes.entries()) {
        if (this.#restored.has(index)) continue;
        ctx.fillStyle = index === this.#room ? '#19283e38' : '#111b2b75';
        ctx.fillRect(imageX + dw * (offset - .045), imageY + dh * .43, dw * .09, dh * .35);
      }
    } else {
      ctx.fillStyle = '#243d55';
      ctx.fillRect(w * .15, h * .32, w * .74, h * .33);
      ctx.fillStyle = '#38607e';
      ctx.fillRect(w * .2, h * .25, w * .64, h * .07);
      ctx.fillRect(w * .24, h * .65, w * .54, h * .08);
      ctx.fillStyle = '#5188a7';
      ctx.fillRect(w * .1, h * .41, w * .15, h * .08);
    }

    const lineY = Math.round(imageY + imageHeight * .82);
    for (const [i, offset] of nodes.entries()) {
      const x = Math.round(imageX + imageWidth * offset);
      this.canvas.parentElement?.style.setProperty('--room-' + i, (x / w) * 100 + '%');
      ctx.fillStyle = this.#restored.has(i) ? palette[i] : i === this.#room ? '#ffca7d' : '#698194';
      ctx.fillRect(x - 3, lineY - 2, 7, 4);
      if (this.#restored.has(i)) {
        ctx.globalAlpha = .55;
        ctx.fillRect(x - 1, lineY - 10, 3, 5);
        ctx.globalAlpha = 1;
      }
    }

    if (this.#repair) {
      const elapsed = performance.now() - this.#repair.start;
      if (elapsed >= 740 || document.hidden) {
        this.#repair = null;
      } else {
        const {index} = this.#repair;
        const x = Math.round(imageX + imageWidth * nodes[index]);
        const frame = Math.min(frameCount - 1, Math.floor(elapsed * frameCount / 740));
        const y = Math.round(imageY + imageHeight * .62);
        const radius = Math.min(24, Math.max(10, Math.floor(imageWidth * .042)));
        const strip = this.#strips.get(index);
        if (strip) ctx.drawImage(strip, frame * frameSize, 0, frameSize, frameSize,
          x - radius, y - radius, radius * 2, radius * 2);
      }
    }
  }
}
