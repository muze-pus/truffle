import { logger } from "@truffle/db/logger";
const debug = logger("db:meta:pouch:types");

import PouchDB from "pouchdb";

import type { Collections, CollectionName } from "@truffle/db/meta/collections";
import type * as Id from "@truffle/db/meta/id";

export type History = PouchDB.Core.IdMeta & PouchDB.Core.GetMeta;

export type Historical<T> = T & History;

export interface Adapter<C extends Collections> {
  every<N extends CollectionName<C>, I extends PouchDB.Core.IdMeta>(
    collectionName: N
  ): Promise<Historical<I>[]>;

  retrieve<N extends CollectionName<C>, I extends PouchDB.Core.IdMeta>(
    collectionName: N,
    references: (Pick<I, "_id"> | undefined)[]
  ): Promise<(Historical<I> | undefined)[]>;

  search<N extends CollectionName<C>, I extends PouchDB.Core.IdMeta>(
    collectionName: N,
    options: PouchDB.Find.FindRequest<{}>
  ): Promise<Historical<I>[]>;

  record<N extends CollectionName<C>, I extends PouchDB.Core.IdMeta>(
    collectionName: N,
    inputs: (I | undefined)[],
    options: { overwrite?: boolean }
  ): Promise<(Historical<I> | undefined)[]>;

  forget<N extends CollectionName<C>, I extends PouchDB.Core.IdMeta>(
    collectionName: N,
    references: (Pick<I, "_id"> | undefined)[]
  ): Promise<void>;
}

/**
 * @category Definitions
 */
export type Definitions<C extends Collections> = {
  [N in CollectionName<C>]: Definition<C, N>;
};

/**
 * @category Definitions
 */
export type Definition<C extends Collections, N extends CollectionName<C>> = {
  createIndexes: PouchDB.Find.CreateIndexOptions["index"][];
} & Id.Definition<C, N>;
