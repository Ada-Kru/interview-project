# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Run the demo in Docker

Requires Docker with Compose v2. The demo runs against
[MiniStack](https://ministack.org/), a local AWS emulator.

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

## Local development

Start the emulator, bootstrap and deploy the stack, then run the API tests:

```bash
docker compose up -d ministack
npm run local-bootstrap
npm run local-deploy
npm run test:api
```

MiniStack IAM enforcement is disabled by default. The CDK bootstrap staging
bucket denies non-TLS requests, so enabling `MINISTACK_AUTH=true` requires
serving MiniStack over HTTPS.

## Useful commands

* `npm run build`          type-check the project
* `npm run watch`          watch for changes and type-check
* `npm run local-bootstrap` bootstrap the CDK environment in MiniStack
* `npm run local-synth`    synthesize the stack against MiniStack
* `npm run local-deploy`   deploy the stack to MiniStack
* `npm run test:api`       run the Playwright API tests against MiniStack

* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
