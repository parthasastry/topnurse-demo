import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { APIGatewayProxyHandler } from 'aws-lambda';

const dynamo = new DynamoDBClient({});
const HOSPITALS_TABLE = process.env.HOSPITALS_TABLE_NAME!;

export interface HospitalItem {
  hospitalId: string;
  name?: string;
  [key: string]: unknown;
}

export const handler: APIGatewayProxyHandler = async () => {
  const result = await dynamo.send(
    new ScanCommand({
      TableName: HOSPITALS_TABLE,
    })
  );

  const items = (result.Items ?? []).map((item) => unmarshall(item) as HospitalItem);
  const hospitals = items.map((item) => ({
    hospitalId: item.hospitalId,
    name: item.name ?? item.hospitalId,
  }));

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ hospitals }),
  };
};
