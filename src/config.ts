// Game-wide settings.

/** The real-world spot the loop starts from: the end of Road 3 ("3rd Road Taaki"), Nallasopara West. */
export const REAL_START = { lat: 19.42335, lon: 72.808602 };

export interface LifeBudget {
  cars: number;
  pedestrians: number;
  animals: number;
  /** how far from you things are kept alive (m); the curve hides a car beyond ~130 m */
  radius: number;
}

export const LIFE_DESKTOP: LifeBudget = { cars: 40, pedestrians: 80, animals: 16, radius: 190 };
export const LIFE_MOBILE: LifeBudget = { cars: 22, pedestrians: 40, animals: 10, radius: 170 };
