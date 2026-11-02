// Handlers read these at module load time, so they must be set before the
// test file imports the handler modules.
process.env.DATABASE_ARN =
  'arn:aws:rds:us-east-1:000000000000:cluster:test';
process.env.DATABASE_SECRET_ARN =
  'arn:aws:secretsmanager:us-east-1:000000000000:secret:test';
process.env.LOCATIONS_DB_NAME = 'locations_api';
process.env.LOCATIONS_GEODATA_QUEUE_URL =
  'http://localhost:4566/000000000000/FetchGeodataQueue';
