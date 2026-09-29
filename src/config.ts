// Game-wide settings.

/** Where a new game starts: the end of 3rd Road near the water tank (taaki), Shriprastha, Nallasopara West. */
export const START = {
  lat: 19.42335,
  lon: 72.808602,
  board: '3rd Road Taaki',
};

export interface LifeBudget {
  cars: number;
  pedestrians: number;
  animals: number;
  /** metres around the player where traffic, people and animals are simulated */
  radius: number;
}

export const LIFE_DESKTOP: LifeBudget = { cars: 45, pedestrians: 60, animals: 26, radius: 420 };
export const LIFE_MOBILE: LifeBudget = { cars: 22, pedestrians: 30, animals: 14, radius: 300 };
