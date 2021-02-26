/**
 * @category Internal processor
 * @packageDocumentation
 */
import { logger } from "@truffle/db/logger";
const debug = logger("db:network:load:networksForBlocks");

import type { DataModel, Resource, Input } from "@truffle/db/resources";
import { resources, Process } from "@truffle/db/process";

export function* process<
  Network extends Pick<Resource<"networks">, "id" | keyof Input<"networks">>
>(options: {
  network: Omit<Input<"networks">, "historicBlock">;
  blocks: DataModel.Block[];
}): Process<(Network | undefined)[]> {
  debug("Processing adding networks for blocks...");
  const { network, blocks } = options;

  const networks = yield* resources.load(
    "networks",
    blocks.map(block =>
      block
        ? {
            name: network.name,
            networkId: network.networkId,
            historicBlock: block
          }
        : undefined
    )
  );

  debug("Processed adding networks for blocks.");
  return networks.map((reference, index) =>
    reference
      ? ({
          ...network,
          id: reference.id,
          historicBlock: blocks[index]
        } as Network)
      : undefined
  );
}
