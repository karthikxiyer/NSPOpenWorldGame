/**
 * Every colour in NSP Loop, in one place.
 *
 * Late-May afternoon in Nalasopara West: warm dusty ochre ground, violet-grey asphalt,
 * faded pastel chawls and towers, gulmohar in bloom, and a few saturated accents
 * (saffron, marigold, teal, sign-blue) kept for focal objects.
 */
export const PAL = {
  // sky & atmosphere
  skyTop: 0x78addf,
  skyMid: 0xcfe2f3,
  skyHaze: 0xfbe0c8,
  cloud: 0xfff8ee,
  cloudShade: 0xeadfe8,
  fog: 0xf0e2d2,

  // light
  sun: 0xffdcae,
  fill: 0xa6b6f0,
  bounce: 0xe2cdd8,
  hemiSky: 0xdfe8ff,
  hemiGround: 0xc4a88e,
  shadowTint: 0x6b5c8e,

  // ink
  ink: 0x3a2f45,

  // ground
  dust: 0xd4b88e,
  dustDark: 0xc2a57c,
  road: 0x827d8c,
  roadWorn: 0x958f9a,
  roadPatch: 0x6f6a78,
  footpath: 0xcdc2b6,
  paver: 0xd9ccbd,
  kerbYellow: 0xf2c230,
  kerbBlack: 0x2f2a35,
  lineWhite: 0xf3efe6,
  lineYellow: 0xf0c23a,
  ballast: 0x8c828a,
  sleeper: 0x6b636e,
  railHead: 0xc0bac4,
  railWeb: 0x5d5663,
  compound: 0xe6dccb,
  compoundCap: 0xc8bba8,

  // walls (index into this list from layout code)
  walls: [0xf4ead8, 0xf1d6c4, 0xd7e6e2, 0xe4d9ee, 0xf4e3a6, 0xd2e0f0, 0xf0cfd2, 0xebe5db, 0xc9dbc0, 0xd8cbb4],
  roofSlab: 0xbdb3a8,
  parapet: 0xe2d8ca,
  window: 0x4a5670,
  windowLit: 0x6a7896,
  grill: 0x5a5560,
  shutter: 0x8a8795,
  shutterDark: 0x6e6b7a,
  sintex: 0x2c2a30,

  // accents
  saffron: 0xf08a24,
  marigold: 0xf5b52a,
  teal: 0x2a9d8f,
  red: 0xd8433a,
  signBlue: 0x1f5fae,
  green: 0x2f8f4e,
  maroon: 0x8a1f2d,
  cream: 0xefe6cf,

  // vegetation
  leaf: 0x5c9e5a,
  leafDeep: 0x3f7a4a,
  leafPale: 0x86b877,
  grass: 0x8fb56e,
  gulmohar: 0xe8492f,
  gulmoharLight: 0xf57d3e,
  gulmoharDeep: 0xc2352a,
  trunk: 0x7d6356,
  palm: 0x6aa35a,
  petal: 0xf0603a,

  // taaki & station
  concrete: 0xd9d2c7,
  concreteDark: 0xb3aba2,
  tankPaint: 0xece5d4,
  tankBand: 0x3f86b8,
  platform: 0xcdc3b7,
  platformEdge: 0xf2c230,
  stationBoard: 0xf5d23a,
} as const;
