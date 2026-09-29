# NSP Open World

A lightweight, low-poly open-world browser game set in Nalasopara, Vasai and Virar,
built from OpenStreetMap data. Ride a Honda CB350RS (black/yellow) or drive a
Tata Harrier Kaziranga edition across the Vasai-Virar belt.

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.

## What's in the world

- You start at the **3rd Road Taaki** board in Shriprastha, Nallasopara West, next to the
  Honda CB350RS, with the Harrier parked behind (change it in `src/config.ts`).
- **Traffic** follows the real road network, keeps left and respects one-way streets:
  auto-rickshaws, cars, scooters, tempos and buses (on main roads only).
- **Pedestrians** walk along the streets, crowding around shops, eateries and stations.
- **Animals**: cows (solid, and they often sit in the road), stray dogs and goats that scatter
  from fast vehicles.
- **Local trains**: 12-car Western Railway locals stop at Naigaon, Vasai Road, Nalla Sopara and
  Virar; an 8-car train runs on the Vasai Road - Diva branch via Juichandra and Kaman Road.
  Level-crossing gates close as trains approach and traffic waits for them.

## Map data

Raw OSM data lives in `data/raw/`. The **Fetch OSM data** GitHub Actions workflow
downloads the Geofabrik extract of western India, clips it to the Vasai-Virar belt
with osmium and splits it into layers (`scripts/fetch-osm.sh`). Run it from the
Actions tab to refresh the map.

## Running locally

```bash
npm install
npm run build:tiles   # data/raw -> public/world (tiles + ground texture)
npm run dev           # http://localhost:5173
```

Useful URL parameters: `?at=19.4674,72.7331` spawns at a latitude/longitude
(e.g. Arnala beach), `?debug` logs FPS and draw calls to the console.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Move / drive | WASD / arrows | Left stick, RT / LT | Left stick |
| Run / handbrake | Shift / Space | X | RUN / BRAKE |
| Get on / off | E | A | E |
| Look around | Drag mouse | Right stick | Drag right side |
| Camera distance | C | Y | – |

## Deploying

The **Build and deploy** workflow builds the tiles and the bundle on every push
and publishes to GitHub Pages from the default branch. Enable it once under
*Settings → Pages → Source: GitHub Actions*.
