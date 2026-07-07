/**
 * Estate Station Directory read — the ONE window onto `org.v_estate_station`
 * (DECISION-GATE-007/008, the Station Partition Doctrine; canonicalised into the package
 * at EPIC-008-M005 from RMS's shipped consumer).
 *
 * Stations live with their owning app (DC's in `public.station`, orphan farm-bays/trucks
 * in `org.station`); a consumer that scans at ALL of them owns NONE. The federating
 * `org.v_estate_station` view (frozen shape: `station_id · owner_app · kind · code · name
 * · active · site_id · site_name`) is the only cross-app read; a consumer stores the bare
 * `station_id` (estate-permanent, preserved on stewardship handover) and NEVER queries a
 * sibling's station table directly.
 *
 * FAIL-SAFE / FAIL-OPEN (pattern §5). The directory is validation + display enrichment —
 * never a gate. A read error or an environment without the view (a standalone DEV sandbox)
 * reports `available:false`, and callers treat that as "cannot validate" (skip), NOT
 * "invalid". A scan is never blocked by the directory.
 */

import type { Queryable } from "../queryable";

/** One station as the frozen directory publishes it. */
export interface EstateStation {
  readonly stationId: string;
  readonly ownerApp: string;
  readonly kind: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
  readonly siteId: string | null;
  readonly siteName: string | null;
}

/** A directory lookup outcome: found stations + whether the directory could be read at all.
 *  `available=false` (view absent / read error) means "cannot validate" — callers skip,
 *  never treat as unknown (fail-open). */
export interface DirectoryLookup {
  readonly available: boolean;
  readonly stations: ReadonlyMap<string, EstateStation>;
}

const DIRECTORY_COLUMNS = `station_id::text as station_id, owner_app, kind, code, name,
       active, site_id::text as site_id, site_name`;

interface DirectoryRow {
  station_id: string;
  owner_app: string;
  kind: string;
  code: string;
  name: string;
  active: boolean;
  site_id: string | null;
  site_name: string | null;
}

function toStation(r: DirectoryRow): EstateStation {
  return {
    stationId: r.station_id,
    ownerApp: r.owner_app,
    kind: r.kind,
    code: r.code,
    name: r.name,
    active: r.active,
    siteId: r.site_id,
    siteName: r.site_name,
  };
}

/** Look up a set of station ids in the directory (repeats are deduplicated). Fail-safe:
 *  any error → `available:false`, empty map. */
export async function findEstateStations(
  db: Queryable,
  stationIds: readonly string[],
): Promise<DirectoryLookup> {
  if (stationIds.length === 0) return { available: true, stations: new Map() };
  try {
    const { rows } = await db.query(
      `select ${DIRECTORY_COLUMNS}
         from org.v_estate_station
        where station_id = any($1::uuid[])`,
      [[...new Set(stationIds)]],
    );
    const stations = new Map<string, EstateStation>();
    for (const raw of rows as unknown as DirectoryRow[])
      stations.set(raw.station_id, toStation(raw));
    return { available: true, stations };
  } catch {
    return { available: false, stations: new Map() };
  }
}

/** List directory stations for pickers (e.g. a device-binding screen lists the stations an
 *  app's own sign-in can open sessions at — sessions follow the station's owner). Fail-safe:
 *  any error → `available:false`, empty list. */
export async function listEstateStations(
  db: Queryable,
  filter: { ownerApp?: string; activeOnly?: boolean } = {},
): Promise<{ available: boolean; stations: readonly EstateStation[] }> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.ownerApp !== undefined) {
    params.push(filter.ownerApp);
    where.push(`owner_app = $${params.length}`);
  }
  if (filter.activeOnly === true) where.push(`active = true`);
  try {
    const { rows } = await db.query(
      `select ${DIRECTORY_COLUMNS}
         from org.v_estate_station
        ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
        order by owner_app, code`,
      params,
    );
    return { available: true, stations: (rows as unknown as DirectoryRow[]).map(toStation) };
  } catch {
    return { available: false, stations: [] };
  }
}
