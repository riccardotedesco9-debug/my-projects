// Camera system: zoom/pan with viewport culling and LOD
import { MIN_ZOOM, MAX_ZOOM, ZOOM_SPEED, ZOOM_LERP, LOD_GLYPH_THRESHOLD, LOD_SPRITE_THRESHOLD } from './constants';

export interface Camera {
  x: number;        // world-space top-left X (canvas units)
  y: number;        // world-space top-left Y
  zoom: number;
  targetZoom: number;
  // Zoom anchor: the world point that should stay under the cursor during zoom
  anchorWX: number;
  anchorWY: number;
  anchorSX: number; // screen position of anchor
  anchorSY: number;
}

export interface ViewBounds {
  x0: number; y0: number;
  x1: number; y1: number;
}

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, targetZoom: 1, anchorWX: 0, anchorWY: 0, anchorSX: 0, anchorSY: 0 };
}

// Smooth zoom interpolation — keeps anchor point fixed under cursor
export function updateCamera(cam: Camera): void {
  if (Math.abs(cam.zoom - cam.targetZoom) < 0.001) {
    cam.zoom = cam.targetZoom;
    return;
  }
  cam.zoom += (cam.targetZoom - cam.zoom) * ZOOM_LERP;
  // Re-derive camera position so anchor stays at its screen position
  cam.x = cam.anchorWX - cam.anchorSX / cam.zoom;
  cam.y = cam.anchorWY - cam.anchorSY / cam.zoom;
}

// Zoom centered on screen position (mouse cursor)
export function zoomAt(cam: Camera, screenX: number, screenY: number, delta: number): void {
  const direction = delta > 0 ? -1 : 1;
  const newTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.targetZoom * (1 + direction * ZOOM_SPEED)));

  // Record the world point under the cursor as the zoom anchor
  cam.anchorWX = cam.x + screenX / cam.zoom;
  cam.anchorWY = cam.y + screenY / cam.zoom;
  cam.anchorSX = screenX;
  cam.anchorSY = screenY;

  cam.targetZoom = newTarget;
}

export function pan(cam: Camera, screenDx: number, screenDy: number): void {
  cam.x -= screenDx / cam.zoom;
  cam.y -= screenDy / cam.zoom;
  // Update anchor to current center so zoom doesn't jump after panning
  cam.anchorWX = cam.x + cam.anchorSX / cam.zoom;
  cam.anchorWY = cam.y + cam.anchorSY / cam.zoom;
}

export function clampCamera(cam: Camera, worldPixelW: number, worldPixelH: number, canvasW: number, canvasH: number): void {
  const viewW = canvasW / cam.zoom;
  const viewH = canvasH / cam.zoom;
  const minX = -viewW * 0.1;
  const minY = -viewH * 0.1;
  const maxX = worldPixelW - viewW * 0.9;
  const maxY = worldPixelH - viewH * 0.9;
  cam.x = Math.max(minX, Math.min(maxX, cam.x));
  cam.y = Math.max(minY, Math.min(maxY, cam.y));
}

export function getVisibleCells(cam: Camera, worldW: number, worldH: number, cellSize: number, canvasW: number, canvasH: number): ViewBounds {
  const x0 = Math.max(0, Math.floor(cam.x / cellSize) - 1);
  const y0 = Math.max(0, Math.floor(cam.y / cellSize) - 1);
  const x1 = Math.min(worldW - 1, Math.ceil((cam.x + canvasW / cam.zoom) / cellSize) + 1);
  const y1 = Math.min(worldH - 1, Math.ceil((cam.y + canvasH / cam.zoom) / cellSize) + 1);
  return { x0, y0, x1, y1 };
}

export function applyTransform(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
}

export function resetTransform(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export function screenToWorld(cam: Camera, sx: number, sy: number): [number, number] {
  return [cam.x + sx / cam.zoom, cam.y + sy / cam.zoom];
}

export function getLOD(cam: Camera): number {
  if (cam.zoom >= LOD_SPRITE_THRESHOLD) return 2;
  if (cam.zoom >= LOD_GLYPH_THRESHOLD) return 1;
  return 0;
}

export function resetCamera(cam: Camera): void {
  cam.x = 0; cam.y = 0;
  cam.zoom = 1; cam.targetZoom = 1;
  cam.anchorWX = 0; cam.anchorWY = 0;
  cam.anchorSX = 0; cam.anchorSY = 0;
}

export function centerOn(cam: Camera, worldX: number, worldY: number, canvasW: number, canvasH: number): void {
  cam.x = worldX - (canvasW / cam.zoom) / 2;
  cam.y = worldY - (canvasH / cam.zoom) / 2;
  cam.anchorWX = worldX;
  cam.anchorWY = worldY;
  cam.anchorSX = canvasW / 2;
  cam.anchorSY = canvasH / 2;
}
