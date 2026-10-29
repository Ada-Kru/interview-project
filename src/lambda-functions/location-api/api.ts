import { Router } from "@aws-lambda-powertools/event-handler/http";
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from "aws-lambda";

const rtr = new Router();

rtr.get('/api/v1/locations', async () => {

  return [{ id: 'TEST' }];
});

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  return rtr.resolve(event, context);
};
