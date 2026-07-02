/**
 * Canvas battle stage — fixed 1920×1080 design board, scaled to the fight viewport.
 * HTML HUD (VS bar, pause, team dots) stays on top; sprites, path, bg, and FX render here.
 */
(function (global) {
    const DESIGN_W = 1920;
    const DESIGN_H = 1080;
    const SPRITE_W = 170;
    const SPRITE_H = 170;
    const PLAYER_HOME_X = DESIGN_W * 0.1;
    const ENEMY_HOME_X = DESIGN_W * 0.9;
    const GROUND_Y = DESIGN_H * 0.68;
    const MELEE_GAP = 2;

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = "async";
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Failed to load " + url));
            img.src = url;
        });
    }

    class BattleCanvasStage {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext("2d");
            this.ctx.imageSmoothingEnabled = false;
            this.scale = 1;
            this.offsetX = 0;
            this.offsetY = 0;
            this.running = false;
            this.bgImg = null;
            this.pathImg = null;
            this.flash = 0;
            this._gifHosts = {
                player: this._createGifHost(),
                enemy: this._createGifHost(),
            };
            this.fighters = {
                player: this._makeFighter("player"),
                enemy: this._makeFighter("enemy"),
            };
            this.fx = [];
            this._raf = null;
            this._resizeObs = null;
        }

        _createGifHost() {
            const img = document.createElement("img");
            img.alt = "";
            img.decoding = "async";
            img.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
            return img;
        }

        _makeFighter(side) {
            const homeX = side === "player" ? PLAYER_HOME_X : ENEMY_HOME_X;
            return {
                side,
                homeX,
                x: homeX,
                y: GROUND_Y,
                offsetX: 0,
                offsetY: 0,
                alpha: 1,
                mirrored: false,
                visible: false,
                img: null,
                src: "",
                name: "",
                shakeT: 0,
                shakeKind: "",
            };
        }

        mount(container) {
            this.container = container;
            container.querySelector(".battle-canvas-wrap")?.remove();
            const wrap = document.createElement("div");
            wrap.className = "battle-canvas-wrap";
            wrap.appendChild(this.canvas);
            Object.values(this._gifHosts).forEach((img) => wrap.appendChild(img));
            container.insertBefore(wrap, container.firstChild);
            this._resizeObs = new ResizeObserver(() => this.resize());
            this._resizeObs.observe(container);
            this.resize();
            this.start();
        }

        unmount() {
            this.stop();
            this._resizeObs?.disconnect();
            this._resizeObs = null;
            this.canvas.remove();
            this.container = null;
            this.bgImg = null;
            this.pathImg = null;
            this.fx = [];
        }

        resize() {
            if (!this.container) return;
            const rect = this.container.getBoundingClientRect();
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
            this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
            this.canvas.style.width = rect.width + "px";
            this.canvas.style.height = rect.height + "px";
            const sx = rect.width / DESIGN_W;
            const sy = rect.height / DESIGN_H;
            this.scale = Math.max(sx, sy);
            this.offsetX = (rect.width - DESIGN_W * this.scale) / 2;
            this.offsetY = (rect.height - DESIGN_H * this.scale) / 2;
            this._dpr = dpr;
        }

        start() {
            if (this.running) return;
            this.running = true;
            const tick = () => {
                if (!this.running) return;
                this._step();
                this._draw();
                this._raf = requestAnimationFrame(tick);
            };
            this._raf = requestAnimationFrame(tick);
        }

        stop() {
            this.running = false;
            if (this._raf) cancelAnimationFrame(this._raf);
            this._raf = null;
        }

        async setBackground(url) {
            if (!url) { this.bgImg = null; return; }
            try { this.bgImg = await loadImage(url); } catch { this.bgImg = null; }
        }

        async setPath(url) {
            if (!url) { this.pathImg = null; return; }
            try { this.pathImg = await loadImage(url); } catch { this.pathImg = null; }
        }

        async setFighterSprite(side, src, name, mirrored) {
            const f = this.fighters[side];
            const host = this._gifHosts[side];
            if (!f || !src) return;
            f.name = name || "";
            f.mirrored = !!mirrored;
            f.visible = true;
            f.src = src;
            host.src = src;
            try {
                f.img = host.complete && host.naturalWidth ? host : await loadImage(src);
            } catch {
                f.img = null;
            }
        }

        hideFighter(side) {
            const f = this.fighters[side];
            if (f) f.visible = false;
        }

        resetFighterTransform(side) {
            const f = this.fighters[side];
            if (!f) return;
            f.offsetX = 0;
            f.offsetY = 0;
            f.alpha = 1;
            f.shakeT = 0;
            f.x = f.homeX;
        }

        getFighterBox(side) {
            const f = this.fighters[side];
            if (!f || !f.visible) return null;
            const w = SPRITE_W;
            const h = SPRITE_H;
            const x = (side === "player" ? f.x : f.x - w) + f.offsetX;
            const y = f.y - h + f.offsetY;
            return { left: x, right: x + w, top: y, bottom: f.y + f.offsetY, cx: x + w / 2, cy: y + h / 2 };
        }

        getMeleeDashGap(atkSide, defSide) {
            const atk = this.getFighterBox(atkSide);
            const def = this.getFighterBox(defSide);
            if (!atk || !def) return 180;
            if (atkSide === "player") {
                return Math.max(0, def.left - MELEE_GAP - atk.right);
            }
            return Math.max(0, atk.left - def.right - MELEE_GAP);
        }

        animateOffset(side, targetX, targetY, durationMs, easing) {
            const f = this.fighters[side];
            if (!f) return Promise.resolve();
            const startX = f.offsetX;
            const startY = f.offsetY;
            const t0 = performance.now();
            return new Promise((resolve) => {
                const step = (now) => {
                    const t = Math.min(1, (now - t0) / durationMs);
                    const e = easing ? easing(t) : t;
                    f.offsetX = startX + (targetX - startX) * e;
                    f.offsetY = startY + (targetY - startY) * e;
                    if (t < 1) requestAnimationFrame(step);
                    else resolve();
                };
                requestAnimationFrame(step);
            });
        }

        dashHorizontal(side, distancePx, durationMs) {
            const dx = side === "player" ? distancePx : -distancePx;
            const f = this.fighters[side];
            if (!f) return Promise.resolve();
            return this.animateOffset(side, f.offsetX + dx, f.offsetY, durationMs, (t) => {
                const c = 0.2; const b = 0.85; const d = 0.25;
                return t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
            });
        }

        dashHome(side, durationMs) {
            return this.animateOffset(side, 0, 0, durationMs, (t) => t * (2 - t));
        }

        async faint(side) {
            const f = this.fighters[side];
            if (!f) return;
            await this.animateOffset(side, f.offsetX, 40, 550, (t) => t * t);
            f.alpha = 0.35;
        }

        async slideIn(side) {
            const f = this.fighters[side];
            if (!f) return;
            f.alpha = 1;
            const from = side === "player" ? -240 : 240;
            f.offsetX = from;
            await this.animateOffset(side, 0, 0, 420, (t) => 1 - Math.pow(1 - t, 3));
        }

        shakeFighter(side, kind) {
            const f = this.fighters[side];
            if (!f) return;
            f.shakeT = 300;
            f.shakeKind = kind || "hit";
        }

        spawnEffect(side, glyph, isUltimate) {
            const box = this.getFighterBox(side);
            if (!box) return;
            this.fx.push({
                type: "glyph",
                text: glyph || "💥",
                x: box.cx,
                y: box.cy,
                life: isUltimate ? 1000 : 650,
                maxLife: isUltimate ? 1000 : 650,
                scale: isUltimate ? 1.6 : 1,
            });
        }

        spawnDamage(side, text, kind) {
            const box = this.getFighterBox(side);
            if (!box) return;
            this.fx.push({
                type: "dmg",
                text: String(text),
                kind: kind || "",
                x: box.cx,
                y: box.cy - SPRITE_H * 0.15,
                life: 1000,
                maxLife: 1000,
                vy: -0.06,
            });
        }

        triggerScreenFlash() {
            this.flash = 350;
        }

        _step() {
            const dt = 16;
            if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
            Object.values(this.fighters).forEach((f) => {
                if (f.shakeT > 0) f.shakeT = Math.max(0, f.shakeT - dt);
            });
            this.fx = this.fx.filter((p) => {
                p.life -= dt;
                if (p.type === "dmg") p.y += p.vy * dt;
                return p.life > 0;
            });
        }

        _toScreen(x, y) {
            return {
                x: (this.offsetX + x * this.scale) * this._dpr,
                y: (this.offsetY + y * this.scale) * this._dpr,
            };
        }

        _draw() {
            const ctx = this.ctx;
            const dpr = this._dpr;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            ctx.save();
            ctx.translate(this.offsetX * dpr, this.offsetY * dpr);
            ctx.scale(this.scale * dpr, this.scale * dpr);

            if (this.bgImg) {
                ctx.drawImage(this.bgImg, 0, 0, DESIGN_W, DESIGN_H);
            } else {
                ctx.fillStyle = "#1a0a2e";
                ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
            }

            if (this.pathImg) {
                const pw = DESIGN_W * 0.68;
                const ph = DESIGN_H * 0.12;
                const px = (DESIGN_W - pw) / 2;
                const py = DESIGN_H - DESIGN_H * 0.24 - ph;
                ctx.drawImage(this.pathImg, px, py, pw, ph);
            }

            ["player", "enemy"].forEach((side) => this._drawFighter(side));

            this.fx.forEach((p) => this._drawFx(p));

            if (this.flash > 0) {
                ctx.fillStyle = `rgba(255,255,255,${0.55 * (this.flash / 350)})`;
                ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
            }

            ctx.restore();
        }

        _drawFighter(side) {
            const f = this.fighters[side];
            const host = this._gifHosts[side];
            const img = (host && host.complete && host.naturalWidth ? host : f?.img);
            if (!f || !f.visible || !img) return;
            const ctx = this.ctx;
            let shakeX = 0;
            if (f.shakeT > 0) {
                const amp = f.shakeKind === "block" ? 2 : 4;
                shakeX = Math.sin((300 - f.shakeT) * 0.08) * amp;
            }
            const w = SPRITE_W;
            const h = SPRITE_H;
            const x = (side === "player" ? f.x : f.x - w) + f.offsetX + shakeX;
            const y = f.y - h + f.offsetY;
            ctx.save();
            ctx.globalAlpha = f.alpha;
            if (f.mirrored) {
                ctx.translate(x + w / 2, y + h / 2);
                ctx.scale(-1, 1);
                ctx.drawImage(img, -w / 2, -h / 2, w, h);
            } else {
                ctx.drawImage(img, x, y, w, h);
            }
            const shadowW = w * 0.55;
            const shadowH = h * 0.1;
            ctx.globalAlpha = 0.28 * f.alpha;
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.beginPath();
            ctx.ellipse(x + w / 2, f.y + f.offsetY - 2, shadowW / 2, shadowH / 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        _drawFx(p) {
            const ctx = this.ctx;
            const a = Math.max(0, p.life / p.maxLife);
            if (p.type === "glyph") {
                ctx.save();
                ctx.globalAlpha = a;
                ctx.font = `${Math.floor(48 * p.scale)}px "Press Start 2P", monospace`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(p.text, p.x, p.y - 20 * (1 - a));
                ctx.restore();
            } else if (p.type === "dmg") {
                ctx.save();
                ctx.globalAlpha = a;
                const color = p.kind === "heal" ? "#4ade80" : p.kind === "miss" ? "#94a3b8" : p.kind === "crit" ? "#facc15" : "#f87171";
                ctx.font = '14px "Press Start 2P", monospace';
                ctx.fillStyle = color;
                ctx.textAlign = "center";
                ctx.fillText(p.text, p.x, p.y);
                ctx.restore();
            }
        }
    }

    global.BattleCanvasStage = BattleCanvasStage;
    global.BATTLE_CANVAS_DESIGN = { W: DESIGN_W, H: DESIGN_H };
})(typeof window !== "undefined" ? window : globalThis);
