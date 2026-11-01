import { buildUpdateParams } from '../../../src/helpers/dynamoDbUpdate';

describe('buildUpdateParams', () => {
  it('builds a SET expression with names and values', () => {
    expect(buildUpdateParams({ name: 'Ada', latitude: null })).toEqual({
      UpdateExpression: 'SET #name = :name, #latitude = :latitude',
      ExpressionAttributeNames: {
        '#name': 'name',
        '#latitude': 'latitude',
      },
      ExpressionAttributeValues: {
        ':name': 'Ada',
        ':latitude': null,
      },
    });
  });

  it('handles a single field', () => {
    expect(buildUpdateParams({ city: 'Seattle' })).toEqual({
      UpdateExpression: 'SET #city = :city',
      ExpressionAttributeNames: { '#city': 'city' },
      ExpressionAttributeValues: { ':city': 'Seattle' },
    });
  });

  it('preserves every entry it is given', () => {
    const params = buildUpdateParams({
      latitude: 47.6062,
      longitude: -122.3321,
      geodataStatus: 'MATCHED',
    });

    expect(params.ExpressionAttributeValues).toEqual({
      ':latitude': 47.6062,
      ':longitude': -122.3321,
      ':geodataStatus': 'MATCHED',
    });
    expect(params.UpdateExpression).toBe(
      'SET #latitude = :latitude, #longitude = :longitude, #geodataStatus = :geodataStatus',
    );
  });
});
