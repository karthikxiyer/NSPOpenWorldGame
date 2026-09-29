#!/usr/bin/env bash
# Downloads OpenStreetMap data for the Vasai-Virar belt.
# Runs in GitHub Actions (this dev environment cannot reach the OSM servers).
#
# Source: Geofabrik's daily extract of western India, clipped to our bounding box
# with osmium, then split into layers by scripts/osm-to-layers.mjs.
# Output: data/raw/<layer>.json.gz + data/raw/meta.json
set -euo pipefail

# south,west,north,east — Vasai Fort / Naigaon up to Arnala / Jivdani, coast to Tungareshwar
S=19.315; W=72.715; N=19.505; E=72.935
OUT_DIR="${1:-data/raw}"
WORK="${RUNNER_TEMP:-/tmp}/osm"
mkdir -p "$OUT_DIR" "$WORK"

download() {
  local url="$1" dest="$2"
  for attempt in 1 2 3 4; do
    echo "download $url (attempt $attempt)"
    if curl -fL --retry 3 --max-time 3600 -A "NSPOpenWorldGame data fetch (github actions)" -o "$dest" "$url"; then
      return 0
    fi
    sleep $((attempt * 20))
  done
  return 1
}

PBF="$WORK/region.osm.pbf"
download "https://download.geofabrik.de/asia/india/western-zone-latest.osm.pbf" "$PBF" \
  || download "https://download.geofabrik.de/asia/india-latest.osm.pbf" "$PBF"
ls -lh "$PBF"

echo "clipping to $W,$S,$E,$N"
osmium extract --overwrite --strategy smart -b "$W,$S,$E,$N" -o "$WORK/area.osm.pbf" "$PBF"
osmium fileinfo -e "$WORK/area.osm.pbf" | grep -E "Number of (nodes|ways|relations)" || true

cat > "$WORK/export.json" <<'JSON'
{
  "attributes": { "type": true, "id": true },
  "linear_tags": true,
  "area_tags": true,
  "exclude_tags": ["created_by", "source", "source:*", "note", "fixme", "FIXME"]
}
JSON
osmium export --overwrite -c "$WORK/export.json" -f geojsonseq -o "$WORK/area.geojsonseq" "$WORK/area.osm.pbf"
ls -lh "$WORK/area.geojsonseq"

node "$(dirname "$0")/osm-to-layers.mjs" "$WORK/area.geojsonseq" "$OUT_DIR" "$S,$W,$N,$E" \
  "$(osmium fileinfo -g header.option.osmosis_replication_timestamp "$PBF" 2>/dev/null || echo unknown)"

ls -la "$OUT_DIR"
# GitHub rejects files > 100 MB
for f in "$OUT_DIR"/*.gz; do
  sz=$(stat -c %s "$f")
  if [ "$sz" -gt 95000000 ]; then echo "$f too large ($sz bytes)" >&2; exit 1; fi
done
