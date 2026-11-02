# Interview Project For Adam Krueger

## Run the demo in Docker

Requires Docker with Compose v2. The demo runs on MiniStack, a local AWS emulator.
MiniStack uses the host Docker socket to run a real Postgres container for the
RDS Data API.

```bash
docker compose up --build --wait
```

Since there is no delete route, each time the container is started the database is intentionally cleared.

The API is then available at `http://localhost:8080/api/v1/locations`

* POST  `/locations`        Create a new location
* PATCH `/locations/{id}`  Update an existing location
* GET   `/locations`         Get a list of all locations ordered by creation date (newest first)
* GET   `/locations/{id}`    Get a single location

### Example request bodies

`POST /locations` All fields required.  Latitude and longitude will be fetched from the API shortly, they will be null until then:

```json
{
  "name": "Dallas Branch",
  "city": "Dallas",
  "state": "TX",
  "country": "United States"
}
```

`PATCH /locations/{id}` All fields are optional, at least one is required.  The "city", "state", and "country" fields will trigger an update of the latitude and longitude:

```json
{
  "name": "Portland Branch",
  "city": "Portland",
  "state": "Oregon",
  "country": "United States"
}
```

### Running tests

To run tests:
```bash
docker compose exec demo npm run test:unit
```
```bash
docker compose exec demo npm run test:api
```

## Stopping the container

To stop the container:
```bash
docker compose down
```

## Local development

Start the emulator, create the local Aurora database, bootstrap and deploy the
stack, then run the migration and API tests:

```bash
docker compose up -d ministack
npm run local-db -- --write-env /tmp/demo/database.env
set -a
source /tmp/demo/database.env
set +a
npm run local-bootstrap
npm run local-deploy
npm run db:migrate -- --reset
npm run test:api
```

## Improvements to be made for production

* Use a logging library like AWS Lambda Powertools logger to save logs in JSON format
* Add alarms for recurring errors and the dead letter queue filling up
* Handle third party API rate limits by storing the last access time in a database
* Use GitHub CI/CD to automatically run tests before allowing pull requests
* Implement user authentication
* Add a delete route
* Update the list all locations route to allow filtering by fields like city, state, country
* Standardize the city, state, and country names using the Geocoding API
