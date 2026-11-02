# Interview Project For Adam Krueger

## Run the demo in Docker

Requires Docker with Compose v2. The demo runs on MiniStack, a local AWS emulator.

```bash
docker compose up --build --wait
```

Since there is no delete route, each time the container is started the database is intentionally cleared.

The API is then available at `http://localhost:8080/api/v1/locations`

POST /locations        Create a new location
PATCH /locations/{id}  Update a location
GET /locations         Get a list of all locations
GET /locations/{id}    Get a single location

### Request bodies

`POST /locations` all fields required:

```json
{
  "name": "Space Needle",
  "city": "Seattle",
  "state": "WA",
  "country": "United States"
}
```

`PATCH /locations/{id}` - all fields are optional, at least one is required:

```json
{
  "city": "Portland",
  "state": "Oregon"
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

Start the emulator, bootstrap and deploy the stack, then run the API tests:

```bash
docker compose up -d ministack
npm run local-bootstrap
npm run local-deploy
```
