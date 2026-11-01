// Handlers read these at module load time, so they must be set before the
// test file imports the handler modules.
process.env.LOCATIONS_TABLE_NAME = 'Locations';
process.env.LOCATIONS_GEODATA_QUEUE_URL =
  'http://localhost:4566/000000000000/FetchGeodataQueue';
