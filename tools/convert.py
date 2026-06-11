#!/usr/bin/env python3
"""Convert raw Overpass JSON (buildings/roads/land/pois) into compact
local-coordinate data consumed by the simulation (data/parnu.js).

Projection: simple equirectangular around Pärnu city centre.
x = metres east, z = metres south (matches three.js ground plane usage).
"""
import json, math, os

LAT0, LON0 = 58.3859, 24.4971
M_LAT = 111132.95
M_LON = 111319.49 * math.cos(math.radians(LAT0))

def xz(lat, lon):
    return (round((lon - LON0) * M_LON, 1), round((LAT0 - lat) * M_LAT, 1))

def load(name):
    with open(os.path.join('data', name)) as f:
        return json.load(f)['elements']

# ---------------------------------------------------------------- buildings
BTYPE = {
    'church': ('church', 22), 'cathedral': ('church', 25), 'chapel': ('church', 10),
    'apartments': ('apt', 14), 'dormitory': ('apt', 12),
    'house': ('house', 5.5), 'detached': ('house', 5.5), 'semidetached_house': ('house', 5.5),
    'residential': ('house', 6), 'terrace': ('house', 6), 'bungalow': ('house', 4),
    'garage': ('garage', 2.8), 'garages': ('garage', 2.8), 'shed': ('garage', 2.5),
    'hut': ('garage', 2.5), 'carport': ('garage', 2.5), 'roof': ('garage', 3),
    'industrial': ('ind', 8), 'warehouse': ('ind', 7), 'hangar': ('ind', 8),
    'retail': ('com', 6), 'commercial': ('com', 9), 'office': ('com', 12),
    'supermarket': ('com', 7), 'kiosk': ('com', 3),
    'hotel': ('hotel', 16), 'school': ('civic', 10), 'kindergarten': ('civic', 6),
    'university': ('civic', 12), 'hospital': ('civic', 12), 'civic': ('civic', 9),
    'public': ('civic', 9), 'government': ('civic', 10),
}

def conv_buildings():
    out = []
    for e in load('buildings.json'):
        g = e.get('geometry')
        if not g or len(g) < 4:
            continue
        pts = [xz(p['lat'], p['lon']) for p in g[:-1]]  # drop closing dup
        if len(pts) < 3:
            continue
        t = e.get('tags', {})
        cat, h = BTYPE.get(t.get('building', 'yes'), ('gen', 7))
        try:
            if 'height' in t:
                h = float(t['height'].replace('m', '').strip())
            elif 'building:levels' in t:
                h = float(t['building:levels']) * 3.1 + 1.4
        except ValueError:
            pass
        h = max(2.4, min(h, 80))
        out.append({'p': pts, 'h': round(h, 1), 't': cat})
    return out

# -------------------------------------------------------------------- roads
ROAD_CLASS = {
    'motorway': ('maj', 10), 'trunk': ('maj', 10), 'primary': ('maj', 9),
    'secondary': ('maj', 8), 'tertiary': ('res', 7),
    'residential': ('res', 6), 'unclassified': ('res', 6), 'living_street': ('res', 5),
    'service': ('srv', 4),
    'pedestrian': ('ped', 4), 'footway': ('ped', 2.2), 'path': ('ped', 1.8),
    'cycleway': ('ped', 2.4),
}

def conv_roads():
    out = []
    for e in load('roads.json'):
        g = e.get('geometry')
        if not g or len(g) < 2:
            continue
        cls, w = ROAD_CLASS.get(e['tags'].get('highway'), (None, 0))
        if not cls:
            continue
        out.append({'p': [xz(p['lat'], p['lon']) for p in g], 't': cls, 'w': w})
    return out

# --------------------------------------------------------- land & coastline
def land_cat(t):
    n, lz, lu, ww = t.get('natural'), t.get('leisure'), t.get('landuse'), t.get('waterway')
    if n == 'water' or ww == 'riverbank':
        return 'water'
    if n == 'beach':
        return 'beach'
    if n == 'wood' or lu == 'forest':
        return 'forest'
    if lz in ('park', 'garden', 'playground') or lu in ('grass', 'meadow', 'recreation_ground'):
        return 'park'
    if lz in ('pitch', 'stadium'):
        return 'pitch'
    if lu == 'cemetery':
        return 'cemetery'
    return None

def stitch(lines, tol=1e-9):
    """Join polylines sharing endpoints into longer chains."""
    lines = [list(l) for l in lines]
    changed = True
    while changed:
        changed = False
        for i in range(len(lines)):
            if not lines[i]:
                continue
            for j in range(len(lines)):
                if i == j or not lines[j]:
                    continue
                a, b = lines[i], lines[j]
                if a[-1] == b[0]:
                    lines[i] = a + b[1:]
                elif a[-1] == b[-1]:
                    lines[i] = a + b[-2::-1]
                elif a[0] == b[-1]:
                    lines[i] = b + a[1:]
                elif a[0] == b[0]:
                    lines[i] = b[::-1] + a[1:]
                else:
                    continue
                lines[j] = []
                changed = True
    return [l for l in lines if l]

def clip_poly(pts, lim=8000):
    """Sutherland–Hodgman clip against square [-lim, lim]^2 (отрезает
    хвост реки, уходящий на десятки км за город)."""
    def clip_edge(poly, inside, intersect):
        out = []
        for i in range(len(poly)):
            cur, prv = poly[i], poly[i - 1]
            if inside(cur):
                if not inside(prv):
                    out.append(intersect(prv, cur))
                out.append(cur)
            elif inside(prv):
                out.append(intersect(prv, cur))
        return out
    def x_int(a, b, x):
        t = (x - a[0]) / (b[0] - a[0])
        return (x, a[1] + (b[1] - a[1]) * t)
    def z_int(a, b, z):
        t = (z - a[1]) / (b[1] - a[1])
        return (a[0] + (b[0] - a[0]) * t, z)
    for ins, itr in (
        (lambda p: p[0] >= -lim, lambda a, b: x_int(a, b, -lim)),
        (lambda p: p[0] <= lim, lambda a, b: x_int(a, b, lim)),
        (lambda p: p[1] >= -lim, lambda a, b: z_int(a, b, -lim)),
        (lambda p: p[1] <= lim, lambda a, b: z_int(a, b, lim)),
    ):
        pts = clip_edge(pts, ins, itr)
        if len(pts) < 3:
            return []
    return [(round(x, 1), round(z, 1)) for x, z in pts]

def conv_land():
    polys, coast_ll = [], []
    for e in load('land.json'):
        t = e.get('tags', {})
        if e['type'] == 'way':
            g = e.get('geometry')
            if not g:
                continue
            if t.get('natural') == 'coastline':
                coast_ll.append([(p['lat'], p['lon']) for p in g])
                continue
            cat = land_cat(t)
            if not cat or len(g) < 4 or g[0] != g[-1]:
                continue
            polys.append({'p': [xz(p['lat'], p['lon']) for p in g[:-1]], 't': cat})
        elif e['type'] == 'relation' and land_cat(t) == 'water':
            outers = [[(p['lat'], p['lon']) for p in m['geometry']]
                      for m in e.get('members', [])
                      if m.get('role') == 'outer' and m.get('geometry')]
            for ring in stitch(outers):
                if len(ring) <= 3:
                    continue
                pts = [xz(*q) for q in (ring[:-1] if ring[0] == ring[-1] else ring)]
                pts = clip_poly(pts)
                if len(pts) >= 3:
                    polys.append({'p': pts, 't': 'water'})

    # Build the sea (Pärnu Bay): stitch coastline, close on the seaward side.
    chains = stitch(coast_ll)
    chains.sort(key=len, reverse=True)
    sea = None
    if chains:
        c = chains[0]
        # chain runs NW -> SE along the bay; close via SW corners
        ring = c + [(58.315, c[-1][1] + 0.02), (58.315, 24.39), (c[0][0] + 0.01, 24.39)]
        sea = clip_poly([xz(*q) for q in ring])
    return polys, sea

# --------------------------------------------------------------------- POIs
POI_CAT = {
    'bar': 'night', 'pub': 'night', 'nightclub': 'night',
    'restaurant': 'food', 'cafe': 'food', 'fast_food': 'food',
    'supermarket': 'shop', 'mall': 'shop', 'convenience': 'shop',
    'department_store': 'shop', 'marketplace': 'shop',
    'school': 'school', 'kindergarten': 'school', 'university': 'school', 'college': 'school',
    'theatre': 'culture', 'cinema': 'culture', 'museum': 'culture', 'library': 'culture',
    'place_of_worship': 'culture', 'attraction': 'culture',
    'hotel': 'hotel', 'hospital': 'health', 'clinic': 'health', 'pharmacy': 'health',
    'beach_resort': 'beach', 'water_park': 'beach',
    'fitness_centre': 'sport', 'sports_centre': 'sport', 'stadium': 'sport',
    'bus_station': 'transit', 'fuel': 'transit',
}

def conv_pois():
    out = []
    for e in load('pois.json'):
        t = e.get('tags', {})
        kind = t.get('amenity') or t.get('shop') or t.get('tourism') or t.get('leisure')
        cat = POI_CAT.get(kind)
        if not cat:
            continue
        if 'center' in e:
            lat, lon = e['center']['lat'], e['center']['lon']
        elif 'lat' in e:
            lat, lon = e['lat'], e['lon']
        else:
            continue
        x, z = xz(lat, lon)
        out.append({'x': x, 'z': z, 't': cat, 'n': t.get('name', kind)})
    return out

def main():
    data = {}
    data['buildings'] = conv_buildings()
    data['roads'] = conv_roads()
    data['land'], data['sea'] = conv_land()
    data['pois'] = conv_pois()
    data['origin'] = {'lat': LAT0, 'lon': LON0}
    js = 'window.PARNU = ' + json.dumps(data, separators=(',', ':')) + ';\n'
    with open('data/parnu.js', 'w') as f:
        f.write(js)
    print('buildings', len(data['buildings']), '| roads', len(data['roads']),
          '| land', len(data['land']), '| pois', len(data['pois']),
          '| sea pts', len(data['sea'] or []))
    print('size %.1f MB' % (len(js) / 1e6))

if __name__ == '__main__':
    main()
