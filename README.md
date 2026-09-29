# NSP — Nallasopara West

Real Nallasopara West, from OpenStreetMap, as a tiny cel-shaded planet.

The title screen shows the neighbourhood wrapped into a small planet. Press **Ride** or **Walk**
and it unrolls into the real 1:1 map: you land at the **3rd Road Taaki** (19.42335, 72.808602),
beside the black 10,000-litre water tank, next to your black-and-yellow **Honda CB350RS**, with a
**Tata Harrier Kaziranga** parked behind it.

- **Real streets.** Roads, building footprints, the Western Line, Nalla Sopara station's
  platforms, parks and the ST Depot are where they really are — a 2.4 × 1.5 km patch from
  Shriprastha in the west to the station and the East side.
- **A curved horizon.** The ground bends away like a small planet's, so the world stays
  miniature while positions stay true.
- **No edges.** Ride off one side and you come back in from the other. A ring road (the one
  invented street) runs along the patch edges so the wrap is seamless.

## Running

```bash
npm install
npm run dev       # builds the map patch, then http://localhost:5173
npm run build     # map patch + typecheck + production bundle in dist/
```

URL parameters: `?play=ride` / `?play=walk` skip the title, `?lite` forces the phone-quality
renderer (no shadow maps or supersampling), `?debug` logs FPS and draw calls.

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

- `scripts/build-patch.mjs` cuts the patch out of the raw OSM extract in `data/raw/` (clipping
  roads to the edges, dropping buildings near them, adding the ring road), paints a 2 m/px
  landcover texture, places trees along real roads and in parks, and stands the tank beside the
  road at the start point. It also places the signboards, shopfronts, station building and bus
  stand; `src/world/places.ts` draws them, with every sign face in one canvas atlas.
- `src/world/curve.ts` bends everything in the vertex shader around the player. A small radius
  makes the title planet; a large one the gentle horizon. Animating it is the unroll.
- The map is split into 200 m chunks; each frame every chunk moves to its copy nearest the player,
  which is what makes the edges wrap.
- **The look** — cel shading with violet-shifted shadows, screen-space ink from the depth buffer,
  a split-tone grade, FXAA, hero outlines and a painted sky — is adapted from
  [Sakura Crossing](https://github.com/Kenton-GMI/sakura-crossing) (MIT). See
  `THIRD_PARTY_NOTICES.md`.

- **Real places.** Shops, clinics, hospitals, the bank, temples, the cinema and parks mapped in
  OSM carry their real names on signboards (with Marathi where known); named buildings show their
  society name; named streets get blue boards at their ends. Walk past one and the HUD names it.
- **Station Road bazaar.** Ground floors facing Station Road, ST Depot Road and the other market
  streets are rows of shops — open counters or shutters, awnings, bilingual boards. These shop
  names are generated (typical Nalasopara names), not real businesses.
- **Nalla Sopara station and the ST Depot.** A booking office at the end of Depot Road, numbered
  platforms, footbridges with stairs down to the platforms; the MSRTC stand with its canopy,
  red buses in the bays and the yard's workshop behind.

OpenStreetMap is incomplete here: some blocks have fewer buildings than in reality, and most
building heights are estimated.

## Roadmap

1. ✅ Real map, title planet and unroll, curved horizon, wrap-around, the tank, vehicles
2. ✅ Real places detailed: signboards from OSM names, the station, the ST Depot, Station Road shops
3. Life: traffic on the real road network, pedestrians, animals, Western Line locals, hailing an auto
4. Polish: gulmohar petals, street ambience, phone tuning

Map data © OpenStreetMap contributors (ODbL).
