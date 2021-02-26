/**
 * @category Internal processor
 * @packageDocumentation
 */
import { logger } from "@truffle/db/logger";
const debug = logger("db:network:load:networkGenealogies");

import { Input, Resource, IdObject, toIdObject } from "@truffle/db/resources";
import { resources, Process } from "@truffle/db/process";

import * as Query from "@truffle/db/network/query";

/**
 * Load NetworkGenealogy records for a given set of networks while connected
 * to a blockchain with a provider.
 *
 * We take, as a **precondition**, that all relevant networks are actually
 * part of the same blockchain; i.e., that networks with later historic blocks
 * do in fact descend from networks with earlier historic blocks in the list.
 *
 * Using this assumption, the process is as follows:
 *
 *   1. Sort input networks by block height, filtering out missing values
 *      (since input array can be sparse)
 *
 *   2. Find up to three existing networks in the system that are valid for
 *      the currently connected blockchain ("anchors"):
 *
 *      a. the ancestor of the earliest input network
 *      b. the ancestor of the latest input network
 *      c. the descendant of the latest input network
 *
 *   3. If **2.a.** and **2.b.** are different, find the existing networks
 *      between those (i.e., all of **2.b.**'s ancestors back to **2.a.***).
 *
 *      *****: _**2.a.** is guaranteed to be an ancestor of **2.b.** because of
 *      the above precondition._
 *
 *   4. Merge the following networks into a sorted list:
 *      - all input networks
 *      - any/all existing networks in range determined by step **3.**,
 *        including the boundary condition networks from **2.a.** and **2.b.**
 *      - network from **2.c.**, if it exists.
 *
 *   5. For each pair of networks in this list, generate a corresponding
 *      [[[DataModel.NetworkGenealogyInput | NetworkGenealogyInput] whose
 *      ancestor/descendant are [[DataModel.Network | Networks]] from the
 *      earlier/later item in the pair, respectively.
 *
 *   6. Load these genealogy inputs.
 */
export function* process(options: {
  networks: (Pick<Resource<"networks">, "id" | "historicBlock"> | undefined)[];
  settings?: {
    disableIndex?: boolean;
  };
}): Process<IdObject<"networkGenealogies">[]> {
  debug("Processing loading network genealogies...");
  const { settings: { disableIndex = false } = {} } = options;

  // sort by historic block height
  const inputNetworks = collectNetworks(options);

  if (!inputNetworks.length) {
    return [];
  }

  const earliestInputNetwork = inputNetworks[0];
  const latestInputNetwork = inputNetworks[inputNetworks.length - 1];

  const commonOptions: Pick<
    Parameters<typeof Query.Relation.process>[0],
    "disableIndex" | "exclude"
  > = {
    disableIndex,
    exclude: inputNetworks.map(network => toIdObject<"networks">(network))
  };

  // find anchors
  //

  const earliestInputNetworkAncestor = yield* Query.Relation.process({
    ...commonOptions,
    relationship: "ancestor",
    network: toIdObject<"networks">(earliestInputNetwork)
  });

  const latestInputNetworkAncestor = yield* Query.Relation.process({
    ...commonOptions,
    relationship: "ancestor",
    network: toIdObject<"networks">(latestInputNetwork)
  });

  const latestInputNetworkDescendant = yield* Query.Relation.process({
    ...commonOptions,
    relationship: "descendant",
    network: toIdObject<"networks">(latestInputNetwork)
  });

  // find ancestor to latest input network and use that to find ancestors
  // in our input range
  const existingRelationsInRange = yield* Query.AncestorsBetween.process({
    earliest: earliestInputNetworkAncestor,
    latest: latestInputNetworkAncestor
  });

  // sort all these networks by block height and remove missing
  const networks = collectNetworks({
    networks: [
      earliestInputNetworkAncestor,
      ...inputNetworks,
      ...existingRelationsInRange,
      latestInputNetworkDescendant
    ]
  });

  // build pairwise genealogy inputs
  const networkGenealogies = collectPairwiseGenealogies({
    networks
  });

  // and load
  const results = yield* resources.load(
    "networkGenealogies",
    networkGenealogies
  );

  debug("Processing loading network genealogies...");
  return results.filter(
    (resource): resource is IdObject<"networkGenealogies"> => !!resource
  );
}

/**
 * Given a sparsely-populated list of networks from the same blockchain, sort
 * networks by block height.
 */
function collectNetworks<
  Network extends Pick<Resource<"networks">, "id" | "historicBlock">
>(options: { networks: (Network | undefined)[] }): Network[] {
  debug("networks %O", options.networks);
  // start by ordering non-null networks by block height
  const networks = options.networks
    .filter((network): network is Network => !!network)
    .sort((a, b) => a.historicBlock.height - b.historicBlock.height);

  // return sorted networks
  return networks;
}

/**
 * Given a sorted list of networks, form pairwise NetworkGenealogyInputs where
 * the ancestor is the earlier in the pair and descendant is later in the pair.
 */
function collectPairwiseGenealogies<
  Network extends Pick<Resource<"networks">, "id" | "historicBlock">
>(options: { networks: Network[] }): Input<"networkGenealogies">[] {
  const { networks } = options;

  // handle all-null case
  if (networks.length < 1) {
    return [];
  }

  // for our reduction, we'll need to keep track of the current ancestor for
  // each pair as we step over the descendants for each pair.
  type ResultAccumulator = {
    ancestor: IdObject<"networks">;
    networkGenealogies: Input<"networkGenealogies">[];
  };

  const initialAccumulator: ResultAccumulator = {
    ancestor: toIdObject<"networks">(networks[0]),
    networkGenealogies: []
  };

  // starting after the first ancestor, reduce over each subsequent Network
  // to construct pairwise NetworkGenealogyInputs
  const { networkGenealogies } = networks.slice(1).reduce(
    (
      { ancestor, networkGenealogies }: ResultAccumulator,
      descendant: Network
    ): ResultAccumulator => ({
      ancestor: toIdObject<"networks">(descendant),
      networkGenealogies:
        ancestor.id === descendant.id
          ? networkGenealogies
          : [
              ...networkGenealogies,
              {
                ancestor,
                descendant: toIdObject<"networks">(descendant)
              }
            ]
    }),
    initialAccumulator
  );

  // return pairwise genealogies
  return networkGenealogies;
}
