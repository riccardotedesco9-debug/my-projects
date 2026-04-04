import type { World, SimConfig, Season } from './types';

const SEASON_ORDER: Season[] = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_COLORS: Record<Season, string> = {
  spring: '#44cc66',
  summer: '#cccc44',
  autumn: '#cc8844',
  winter: '#4488cc',
};

export function updateSeasons(world: World, config: SimConfig): void {
  world.seasonTick++;
  if (world.seasonTick >= config.seasonLength / 4) {
    world.seasonTick = 0;
    const currentIdx = SEASON_ORDER.indexOf(world.season);
    world.season = SEASON_ORDER[(currentIdx + 1) % 4];
  }
}

export function getSeasonColor(season: Season): string {
  return SEASON_COLORS[season];
}

export function getSeasonProgress(world: World, config: SimConfig): number {
  return world.seasonTick / (config.seasonLength / 4);
}
