# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Run the demo in Docker

Requires Docker with Compose v2.

```bash
docker compose up --build --wait
```

The API is then available at `http://localhost:8080/api/v1/locations`.

GET /locations         Get a list of all locations
GET /locations/{id}    Get a single location
POST /locations        Create a new location
PATCH /locations/{id}  Update a location

```bash
docker compose exec demo npm run demo:smoke   # smoke test
docker compose down                           # stop (add -v to reset state)
```

## Useful commands

* `npm run build`   type-check the project
* `npm run watch`   watch for changes and type-check

* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

* `npm run test:api` run the Playwright API tests against LocalStack
