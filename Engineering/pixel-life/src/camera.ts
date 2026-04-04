// Camera system: zoom/pan with viewport culling and LOD
import { MIN_ZOOM, MAX_ZOOM, ZOOM_SPEED, ZOOM_LERP, LOD_GLYPH_THRESHOLD, LOD_SPRITE_THRESHOLD } from './constants';

export interface Camera {
  x: number;        // world-space top-left X (canvas units)
  y: number;        // world-space top-left Y
  zoom: number;
  targetZoom: number;
}

export interface ViewBounds {
  x0: number; y0: number; // grid cell range (inclusive)
  x1: number; y1: number;
}

export function createCamera(): Camera {
  return { x: 0, y: 0, zoom: 1, targetZoom: 1 };
}

// Smooth zoom interpolation per frame, adjusting camera position to keep zoom centered
export function updateCamera(cam: Camera, canvasW: number, canvasH: number): void {
  if (Math.abs(cam.zoom - cam.targetZoom) < 0.001) {
    cam.zoom = cam.targetZoom;
    return;
  }
  const oldZoom = cam.zoom;
  cam.zoom += (cam.targetZoom - cam.zoom) * ZOOM_LERP;

  // Keep center of viewport fixed during smooth zoom
  const centerWX = cam.x + canvasW / (2 * oldZoom);
  const centerWY = cam.y + canvasH / (2 * oldZoom);
  cam.x = centerWX - canvasW / (2 * cam.zoom);
  cam.y = centerWY - canvasH / (2 * cam.zoom);
}

// Zoom centered on screen position (mouse cursor)
export function zoomAt(cam: Camera, screenX: number, screenY: number, delta: number): void {
  // Negative delta = zoom in (scroll up), positive = zoom out
  const direction = delta > 0 ? -1 : 1;
  const newTarget = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.targetZoom * (1 + direction * ZOOM_SPEED)));

  // Adjust camera so the point under the cursor stays fixed
  const worldX = cam.x + screenX / cam.zoom;
  const worldY = cam.y + screenY / cam.zoom;
  // After zoom, that same world point should still be at screenX, screenY
  cam.x = worldX - screenX / newTarget;
  cam.y = worldY - screenY / newTarget;

  cam.targetZoom = newTarget;
  // Snap zoom immediately for responsive feel (lerp smooths from here)
  cam.zoom = cam.zoom + (newTarget - cam.zoom) * 0.5;
}

export function pan(cam: Camera, screenDx: number, screenDy: number): void {
  cam.x -= screenDx / cam.zoom;
  cam.y -= screenDy / cam.zoom;
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

// Get visible grid cell range for viewport culling
export function getVisibleCells(cam: Camera, worldW: number, worldH: number, cellSize: number, canvasW: number, canvasH: number): ViewBounds {
  const x0 = Math.max(0, Math.floor(cam.x / cellSize) - 1);
  const y0 = Math.max(0, Math.floor(cam.y / cellSize) - 1);
  const x1 = Math.min(worldW - 1, Math.ceil((cam.x + canvasW / cam.zoom) / cellSize) + 1);
  const y1 = Math.min(worldH - 1, Math.ceil((cam.y + canvasH / cam.zoom) / cellSize) + 1);
  return { x0, y0, x1, y1 };
}

// Apply camera transform to a canvas context
export function applyTransform(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
}

// Reset to screen-space (identity transform)
export function resetTransform(ctx: CanvasRenderingContext2D): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Convert screen coordinates to world coordinates
export function screenToWorld(cam: Camera, sx: number, sy: number): [number, number] {
  return [cam.x + sx / cam.zoom, cam.y + sy / cam.zoom];
}

// LOD level: 0 = dots, 1 = glyphs, 2 = sprites
export function getLOD(cam: Camera): number {
  if (cam.zoom >= LOD_SPRITE_THRESHOLD) return 2;
  if (cam.zoom >= LOD_GLYPH_THRESHOLD) return 1;
  return 0;
}

export function resetCamera(cam: Camera): void {
  cam.x = 0;
  cam.y = 0;
  cam.zoom = 1;
  cam.targetZoom = 1;
}

// Center camera on a world position
export function centerOn(cam: Camera, worldX: number, worldY: number, canvasW: number, canvasH: number): void {
  cam.x = worldX - (canvasW / cam.zoom) / 2;
  cam.y = worldY - (canvasH / cam.zoom) / 2;
}
