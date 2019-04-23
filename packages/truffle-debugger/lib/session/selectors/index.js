import debugModule from "debug";
const debug = debugModule("debugger:session:selectors");

import { createSelectorTree, createLeaf } from "reselect-tree";

import evm from "lib/evm/selectors";
import solidity from "lib/solidity/selectors";

const session = createSelectorTree({
  /**
   * session.info
   */
  info: {
    /**
     * session.info.affectedInstances
     */
    affectedInstances: createLeaf(
      [evm.transaction.instances, evm.info.contexts, solidity.info.sources],

      (instances, contexts, sources) =>
        Object.assign(
          {},
          ...Object.entries(instances).map(([address, { context, binary }]) => {
            debug("instances %O", instances);
            debug("contexts %O", contexts);
            let { contractName, primarySource } = contexts[context];

            let source =
              primarySource !== undefined ? sources[primarySource] : undefined;

            return {
              [address]: {
                contractName,
                source,
                binary
              }
            };
          })
        )
    )
  },

  /**
   * session.transaction (namespace)
   */
  transaction: {
    /**
     * session.transaction (selector)
     * contains the web3 transaction object
     */
    _: state => state.session.transaction,

    /**
     * session.transaction.receipt
     * contains the web3 receipt object
     */
    receipt: state => state.session.receipt,

    /**
     * session.transaction.block
     * contains the web3 block object
     */
    block: state => state.session.block
  },

  /*
   * session.status (namespace)
   */
  status: {
    /*
     * session.status (selector)
     */
    _: state => state.session.status,

    /*
     * session.status.ready
     */
    ready: createLeaf(["./_"], status => status === "READY"),

    /*
     * session.status.waiting
     */
    waiting: createLeaf(["./_"], status => status === "WAITING"),

    /*
     * session.status.isError
     */
    isError: createLeaf(["./_"], status => typeof status === "object"),

    /*
     * session.status.error
     */
    error: createLeaf(["./_"], status => status.error)
  }
});

export default session;
