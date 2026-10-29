export const buildUpdateParams = (body: Record<string, any>) => {
  const ExpressionAttributeNames: Record<string, string> = {};
  const ExpressionAttributeValues: Record<string, any> = {};
  const updateParts = Object.entries(body).map(([key, value]) => {
    ExpressionAttributeNames[`#${key}`] = key;
    ExpressionAttributeValues[`:${key}`] = value;
    return `#${key} = :${key}`;
  });

  return {
    UpdateExpression: `SET ${updateParts.join(', ')}`,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
  };
};
