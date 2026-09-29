# NSP Loop

A 1 km miniature-planet ride around Nallasopara West, cel-shaded in Three.js. You start at the
**3rd Road Taaki** board (the end of Road 3, 19.42335, 72.808602), next to your black-and-yellow
**Honda CB350RS**, with a **Tata Harrier Kaziranga** parked behind it. Ride the loop road round
the planet — past Rajhans Play Park, Fun Fiesta Cinema, the Link Road junction, the Station Road
market, Nalla Sopara station, the ST Depot, Samel Pada and Shriprastha — and you come back to the
Taaki after one kilometre.

The places are real (names from OpenStreetMap) and in their real order, compressed about 2.5x
onto a planet of radius 160 m with the road on the equator and the Western Line beside it.

## Running

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # typecheck + production bundle in dist/
```

URL parameters: `?lite` forces the phone-quality renderer (no shadow maps or supersampling),
`?debug` logs FPS and draw calls.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Walk / ride | WASD / arrows | Left stick, RT / LT | Left stick |
| Run / brake | Shift / Space | X | RUN / BRAKE |
| Get on / off | E | A | E |
| Call your vehicle | V | B | CALL |
| Look around | Drag mouse | Right stick | Drag right side |
| Camera distance | C | Y | – |
| Hide hints | H | – | – |

## How it's built

- **Flat world, bent once.** Everything is authored and simulated on a flat strip (`x` along the
  loop, wrapping every 1005 m; `z` across it). `src/planet/planet.ts` is the only code that knows
  the world is round: it bends static geometry onto the sphere after it is built and seats moving
  things in the local frame every frame.
- **The look** — cel shading with violet-shifted shadows, screen-space ink from the depth buffer,
  a split-tone grade, FXAA, hero outlines and a painted sky — is adapted from
  [Sakura Crossing](https://github.com/Kenton-GMI/sakura-crossing) (MIT). See
  `THIRD_PARTY_NOTICES.md`.
- **No image assets.** Buildings, signs and textures are generated in code (Canvas2D for text).

## Roadmap

1. ✅ Planet, style pipeline, loop road and rail, vehicles, camera and controls
2. The places: hand-detailed zones, signboards, the station in full
3. Life: traffic, pedestrians, animals, the Western Line local, hailing an auto
4. Polish: gulmohar petals, street ambience and music, interactions, phone tuning

Map data © OpenStreetMap contributors (ODbL).
