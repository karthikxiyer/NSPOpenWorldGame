#!/usr/bin/env bash
# Downloads OpenStreetMap data for the Vasai-Virar belt from Overpass.
# Runs in GitHub Actions (this dev environment cannot reach Overpass).
# Output: data/raw/<layer>.json.gz  (Overpass JSON, "out geom" format)
set -euo pipefail

# south,west,north,east — Vasai Fort / Naigaon up to Arnala / Jivdani, coast to Tungareshwar
BBOX="19.315,72.715,19.505,72.935"
OUT_DIR="${1:-data/raw}"
mkdir -p "$OUT_DIR"

ENDPOINTS=(
  "https://overpass-api.de/api/interpreter"
  "https://overpass.kumi.systems/api/interpreter"
  "https://overpass.private.coffee/api/interpreter"
)

HEADER="[out:json][timeout:900][maxsize:2000000000][bbox:${BBOX}];"

declare -A LAYERS
LAYERS[roads]='way[highway]; out geom;'
LAYERS[buildings]='( way[building]; relation[building][type=multipolygon]; ); out geom;'
LAYERS[landuse]='( way[natural]; relation[natural][type=multipolygon]; way[landuse]; relation[landuse][type=multipolygon]; way[leisure]; relation[leisure][type=multipolygon]; way[waterway]; way[amenity=parking]; way[man_made=pier]; way[place=island]; relation[place=island]; ); out geom;'
LAYERS[rail]='( way[railway]; node[railway=station]; node[railway=level_crossing]; ); out geom;'
LAYERS[pois]='( nwr[shop]; nwr[amenity]; nwr[tourism]; nwr[historic]; nwr[leisure=park]; nwr[leisure=beach_resort]; nwr[natural=beach]; nwr[natural=peak]; nwr[craft]; nwr[office]; ); out center tags;'
LAYERS[places]='( node[place]; ); out body;'

fetch() {
  local name="$1" query="$2" tmp="$OUT_DIR/$1.json"
  for attempt in 1 2 3 4; do
    for ep in "${ENDPOINTS[@]}"; do
      echo "[$name] attempt $attempt via $ep"
      if curl -sS --fail --max-time 1200 -A "NSPOpenWorldGame data fetch (github actions)" \
          --data-urlencode "data=${HEADER}${query}" "$ep" -o "$tmp"; then
        # Overpass sometimes returns 200 with a runtime error in "remark"
        if python3 -c "import json,sys; d=json.load(open(sys.argv[1])); r=d.get('remark',''); sys.exit(1 if 'error' in r.lower() else 0); " "$tmp"; then
          local n; n=$(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1]))['elements']))" "$tmp")
          echo "[$name] ok: $n elements, $(du -h "$tmp" | cut -f1)"
          gzip -9 -f -n "$tmp"
          return 0
        fi
        echo "[$name] overpass remark error: $(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('remark'))" "$tmp")"
      fi
      sleep 10
    done
    sleep $((attempt * 30))
  done
  echo "[$name] FAILED" >&2
  return 1
}

for name in places rail pois roads landuse buildings; do
  fetch "$name" "${LAYERS[$name]}"
done

cat > "$OUT_DIR/meta.json" <<JSON
{
  "bbox": [${BBOX}],
  "source": "OpenStreetMap contributors via Overpass API",
  "license": "ODbL-1.0",
  "fetched_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

ls -la "$OUT_DIR"
# GitHub rejects files > 100 MB
for f in "$OUT_DIR"/*.gz; do
  sz=$(stat -c %s "$f")
  if [ "$sz" -gt 95000000 ]; then echo "$f too large ($sz bytes)" >&2; exit 1; fi
done
