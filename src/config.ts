// Game-wide settings.

/** The real-world spot the loop starts from: the end of Road 3 ("3rd Road Taaki"), Nallasopara West. */
export const REAL_START = { lat: 19.42335, lon: 72.808602 };

export interface LifeBudget {
  cars: number;
  pedestrians: number;
  animals: number;
}

// Used by traffic, people and animals (milestone 3).
export const LIFE_DESKTOP: LifeBudget = { cars: 18, pedestrians: 40, animals: 12 };
export const LIFE_MOBILE: LifeBudget = { cars: 10, pedestrians: 20, animals: 8 };
