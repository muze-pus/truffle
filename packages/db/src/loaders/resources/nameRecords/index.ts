import { logger } from "@truffle/db/logger";
const debug = logger("db:loaders:resources:nameRecords");

import camelCase from "camel-case";
import { IdObject, toIdObject } from "@truffle/db/meta";

import { Load } from "@truffle/db/loaders/types";

import { AddNameRecords } from "./add.graphql";
import { forType } from "./get.graphql";
export { AddNameRecords };

type ResolveFunc = (
  name: string,
  type: string
) => Load<DataModel.NameRecord | null>;

function* getResourceName(
  { id }: IdObject,
  type: string
): Load<{ name: string }> {
  const GetResourceName = forType(type);

  const result = yield {
    type: "graphql",
    request: GetResourceName,
    variables: { id }
  };

  return result.data[camelCase(type)];
}

export function* generateNameRecordsLoad(
  resources: IdObject[],
  type: string,
  getCurrent: ResolveFunc
): Load<DataModel.NameRecord[]> {
  const nameRecords = [];
  for (const resource of resources) {
    const { name } = yield* getResourceName(resource, type);

    const current: DataModel.NameRecord = yield* getCurrent(name, type);

    if (current) {
      nameRecords.push({
        name,
        type,
        resource,
        previous: toIdObject(current)
      });
    } else {
      nameRecords.push({
        name,
        type,
        resource
      });
    }
  }

  const result = yield {
    type: "graphql",
    request: AddNameRecords,
    variables: { nameRecords }
  };

  return result.data.nameRecordsAdd.nameRecords;
}
