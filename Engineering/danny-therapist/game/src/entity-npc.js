'use strict';

class NPC {
  constructor({ tx, ty, type, speaker, portrait, dialog, onInteract, isExit = false }) {
    this.x          = tx * TILE + TILE / 2;
    this.y          = ty * TILE + TILE / 2;
    this.type       = type;
    this.speaker    = speaker;
    this.portrait   = portrait || type;
    this.dialog     = dialog;
    this.onInteract = onInteract;
    this.isExit     = isExit;
    this.frame      = 0;
    this._ft        = 0;
    this._excTimer  = 0;
    this.dir        = DIR.DOWN;   // current facing direction
    this.bobY       = 0;          // idle vertical bob offset
  }

  update(dt) {
    this._ft += dt;
    if (this._ft >= 30) { this._ft = 0; this.frame = (this.frame + 1) % 2; }
    this._excTimer += dt;

    // Idle bob — gentle sine wave
    this.bobY = Math.sin(this._excTimer * 0.06) * 2;

    // Face toward player when nearby
    const { x: px, y: py } = player.getPos();
    if (this.isNearPlayer(px, py)) {
      const dx = px - this.x;
      const dy = py - this.y;
      // Pick dominant axis
      if (Math.abs(dx) >= Math.abs(dy)) {
        this.dir = dx > 0 ? DIR.RIGHT : DIR.LEFT;
      } else {
        this.dir = dy > 0 ? DIR.DOWN : DIR.UP;
      }
    }
  }

  isNearPlayer(px, py) {
    const dx = px - this.x, dy = py - this.y;
    return Math.sqrt(dx * dx + dy * dy) < IDIST;
  }

  draw(ctx, camX, camY) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    drawNPC(ctx, sx, sy, this.type, this.dir, this.bobY);

    // Exclamation / arrow bubble when player is near
    const { x: px, y: py } = player.getPos();
    if (this.isNearPlayer(px, py)) {
      const pulse = 0.85 + Math.sin(this._excTimer * 0.2) * 0.15;
      ctx.save();
      ctx.translate(sx, sy - 30 + this.bobY);
      ctx.scale(pulse, pulse);

      if (this.isExit) {
        // Green arrow badge for exits
        ctx.fillStyle = '#00E676';
        ctx.font = 'bold 14px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('→', 0, 0);
      } else {
        // Speech bubble with !
        ctx.fillStyle = '#FFD700';
        ctx.fillRect(-7, -12, 14, 14);
        ctx.fillStyle = '#1A0E08';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('!', 0, -1);
      }
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }
}
