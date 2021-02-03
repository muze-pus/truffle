/**
 * @category Internal processor
 * @packageDocumentation
 */
import { logger } from "@truffle/db/logger";
const debug = logger("db:network:query:relation");

import type { IdObject, Resource } from "@truffle/db/resources";
import type { Process } from "@truffle/db/process";
import * as Fetch from "@truffle/db/network/fetch";
import * as QueryNextPossiblyRelatedNetworks from "./nextPossiblyRelatedNetworks";

/**
 * Issue GraphQL requests and eth_getBlockByNumber requests to determine if any
 * existing Network resources are ancestor or descendant of the connected
 * Network.
 *
 * Iteratively, this queries all possibly-related Networks for known historic
 * block. For each possibly-related Network, issue a corresponding web3 request
 * to determine if the known historic block is, in fact, the connected
 * blockchain's record of the block at that historic height.
 *
 * This queries @truffle/db for possibly-related Networks in batches, keeping
 * track of new candidates vs. what has already been tried.
 */
export function* process(options: {
  relationship: "ancestor" | "descendant";
  network: IdObject<"networks">;
  exclude?: IdObject<"networks">[];
  disableIndex?: boolean;
}): Process<Resource<"networks"> | undefined> {
  const { relationship, network, exclude = [], disableIndex = false } = options;

  // since we're doing this iteratively, track what we've already tried to
  // exclude from further consideration.
  //
  // use provided `exclude` list for initial value
  let alreadyTried: string[] = exclude.map(({ id }) => id);
  let candidates: Resource<"networks">[];

  do {
    // query graphql for new candidates
    ({
      networks: candidates,
      alreadyTried
    } = yield* QueryNextPossiblyRelatedNetworks.process({
      relationship,
      network,
      alreadyTried,
      disableIndex
    }));

    // check blockchain to find a matching network
    for (const candidate of candidates) {
      const { historicBlock } = candidate;
      const block = yield* Fetch.Block.process({
        block: {
          height: historicBlock.height
        }
      });

      if (block && block.hash === historicBlock.hash) {
        return candidate;
      }
    }
  } while (candidates.length > 0);

  // otherwise we got nothin'
}
