import type { SqlParameter } from '@aws-sdk/client-rds-data';
import {
  Location,
  LocationCreateData,
  LocationGeodataStatus,
} from '../lambda-functions/location-api/definitions/types';
import { executeStatement } from './locationsDataApi';

export type LocationUpdate = Partial<
  Pick<
    Location,
    | 'name'
    | 'city'
    | 'state'
    | 'country'
    | 'latitude'
    | 'longitude'
    | 'geodataStatus'
  >
>;

export interface LocationGeodataUpdate {
  latitude: number | null;
  longitude: number | null;
  geodataStatus: LocationGeodataStatus;
}

const LOCATION_COLUMNS = `
  id,
  name,
  city,
  state,
  country,
  latitude,
  longitude,
  geodata_status,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
`;

const UPDATE_COLUMNS = {
  name: 'name',
  city: 'city',
  state: 'state',
  country: 'country',
  latitude: 'latitude',
  longitude: 'longitude',
  geodataStatus: 'geodata_status',
} as const satisfies Record<keyof LocationUpdate, string>;

const mapLocation = (row: Record<string, unknown>): Location => ({
  id: Number(row.id),
  name: String(row.name),
  city: String(row.city),
  state: String(row.state),
  country: String(row.country),
  latitude: row.latitude == null ? null : Number(row.latitude),
  longitude: row.longitude == null ? null : Number(row.longitude),
  geodataStatus: row.geodata_status as LocationGeodataStatus,
  createdAt: String(row.created_at),
});

const stringParam = (name: string, value: string): SqlParameter => ({
  name,
  value: { stringValue: value },
});

const longParam = (name: string, value: number): SqlParameter => ({
  name,
  value: { longValue: value },
});

const valueParam = (name: string, value: unknown): SqlParameter => {
  if (value === null) {
    return {
      name,
      value: { isNull: true },
    };
  }

  if (typeof value === 'number') {
    return {
      name,
      value: { doubleValue: value },
    };
  }

  return {
    name,
    value: { stringValue: String(value) },
  };
};

export async function listLocations(
  page: number,
  pageSize: number,
): Promise<{ items: Location[]; total: number }> {
  const offset = (page - 1) * pageSize;

  const [rows, countRows] = await Promise.all([
    executeStatement(
      `
        SELECT ${LOCATION_COLUMNS}
        FROM locations
        ORDER BY created_at DESC, id DESC
        LIMIT :pageSize
        OFFSET :offset
      `,
      [
        longParam('pageSize', pageSize),
        longParam('offset', offset),
      ],
    ),
    executeStatement('SELECT COUNT(*)::int AS total FROM locations'),
  ]);

  return {
    items: rows.map(mapLocation),
    total: Number(countRows[0]?.total ?? 0),
  };
}

export async function getLocation(id: number): Promise<Location | null> {
  const rows = await executeStatement(
    `
      SELECT ${LOCATION_COLUMNS}
      FROM locations
      WHERE id = :id
      LIMIT 1
    `,
    [longParam('id', id)],
  );

  return rows.length > 0 ? mapLocation(rows[0]) : null;
}

export async function findLocationByPlace(
  data: LocationCreateData,
  excludeId?: number,
): Promise<Location | null> {
  const parameters: SqlParameter[] = [
    stringParam('name', data.name),
    stringParam('city', data.city),
    stringParam('state', data.state),
    stringParam('country', data.country),
  ];

  const excludeClause = excludeId === undefined
    ? ''
    : 'AND id <> :excludeId';

  if (excludeId !== undefined) {
    parameters.push(longParam('excludeId', excludeId));
  }

  const rows = await executeStatement(
    `
      SELECT ${LOCATION_COLUMNS}
      FROM locations
      WHERE lower(btrim(name)) = lower(btrim(:name))
        AND lower(btrim(city)) = lower(btrim(:city))
        AND lower(btrim(state)) = lower(btrim(:state))
        AND lower(btrim(country)) = lower(btrim(:country))
        ${excludeClause}
      ORDER BY id
      LIMIT 1
    `,
    parameters,
  );

  return rows.length > 0 ? mapLocation(rows[0]) : null;
}

export async function createLocation(
  data: LocationCreateData,
): Promise<Location> {
  const rows = await executeStatement(
    `
      INSERT INTO locations (name, city, state, country)
      VALUES (:name, :city, :state, :country)
      RETURNING ${LOCATION_COLUMNS}
    `,
    [
      stringParam('name', data.name),
      stringParam('city', data.city),
      stringParam('state', data.state),
      stringParam('country', data.country),
    ],
  );

  const created = rows[0];

  if (!created) {
    throw new Error('Failed to create location');
  }

  return mapLocation(created);
}

export async function updateLocation(
  id: number,
  patch: LocationUpdate,
): Promise<Location | null> {
  const assignments: string[] = [];
  const parameters: SqlParameter[] = [];

  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }

    const column = UPDATE_COLUMNS[field as keyof typeof UPDATE_COLUMNS];

    if (!column) {
      continue;
    }

    assignments.push(`${column} = :${field}`);
    parameters.push(valueParam(field, value));
  }

  if (assignments.length === 0) {
    return getLocation(id);
  }

  parameters.push(longParam('id', id));

  const rows = await executeStatement(
    `
      UPDATE locations
      SET ${assignments.join(', ')}
      WHERE id = :id
      RETURNING ${LOCATION_COLUMNS}
    `,
    parameters,
  );

  return rows.length > 0 ? mapLocation(rows[0]) : null;
}

export async function updateLocationGeodata(
  id: number,
  data: LocationGeodataUpdate,
): Promise<Location | null> {
  return updateLocation(id, data);
}