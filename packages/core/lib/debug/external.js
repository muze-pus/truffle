const debugModule = require("debug");
const debug = debugModule("lib:debug:external");

const Codec = require("@truffle/codec");
const Fetchers = require("@truffle/source-fetcher").default;
const {InvalidNetworkError} = require("@truffle/source-fetcher");

const {DebugCompiler} = require("./compiler");

class DebugExternalHandler {
  constructor(bugger, config) {
    this.config = config;
    this.bugger = bugger;
  }

  async fetch() {
    let badAddresses = []; //for reporting errors back
    let badFetchers = []; //similar
    let badCompilationAddresses = []; //similar
    let addressesToSkip = new Set(); //addresses we know we can't get source for
    //note: this should always be a subset of unknownAddresses! [see below]
    //get the network id
    const userFetcherNames = this.config.sourceFetchers;
    //sort/filter fetchers by user's order, if given; otherwise use default order
    let sortedFetchers = [];
    if (userFetcherNames) {
      for (let name of userFetcherNames) {
        let Fetcher = Fetchers.find(Fetcher => Fetcher.fetcherName === name);
        if (Fetcher) {
          sortedFetchers.push(Fetcher);
        } else {
          throw new Error(`Unknown external source service ${name}.`);
        }
      }
    } else {
      sortedFetchers = Fetchers;
    }
    const networkId = this.config.network_id; //note: this is a number
    //make fetcher instances. we'll filter out ones that don't support this
    //network (and note ones that yielded errors)
    debug("Fetchers: %o", Fetchers);
    const fetchers = (
      await Promise.all(
        Fetchers.map(async Fetcher => {
          try {
            return await Fetcher.forNetworkId(
              networkId,
              this.config[Fetcher.fetcherName]
            );
          } catch (error) {
            if (!(error instanceof InvalidNetworkError)) {
              //if it's *not* just an invalid network, log the error.
              badFetchers.push(Fetcher.fetcherName);
            }
            //either way, filter this fetcher out
            return null;
          }
        })
      )
    ).filter(fetcher => fetcher !== null);
    //now: the main loop!
    let address;
    while (
      (address = getAnUnknownAddress(this.bugger, addressesToSkip)) !==
      undefined
    ) {
      let found = false;
      let failure = false; //set in case something goes wrong while getting source
      let failureReason; 
      //(not set if there is no source)
      for (const fetcher of fetchers) {
        //now comes all the hard parts!
        //get our sources
        let result;
        try {
          debug("getting sources for %s via %s", address, fetcher.fetcherName);
          result = await fetcher.fetchSourcesForAddress(address);
        } catch (error) {
          debug("error in getting sources! %o", error);
          failure = true;
          failureReason = "fetch";
          continue;
        }
        if (result === null) {
          debug("no sources found");
          //null means they don't have that address
          continue;
        }
        //if we do have it, extract sources & options
        debug("got sources!");
        const {sources, options} = result;
        if (options.language !== "Solidity") {
          //if it's not Solidity, bail out now
          debug("not Solidity, bailing out!");
          addressesToSkip.add(address);
          //break out of the fetcher loop, since *no* fetcher will work here
          break;
        }
        //compile the sources
        const externalConfig = this.config.with({
          compilers: {
            solc: options
          }
        }).merge({
          //turn on docker if the original config has docker
          compilers: {
            solc: {
              docker: ((this.config.compilers || {}).solc || {}).docker
            }
          }
        });
        let compilations;
        try {
          compilations = await new DebugCompiler(externalConfig).compile(
            { sources }
          );
        } catch (error) {
          debug("compile error: %O", error);
          failure = true;
          failureReason = "compile";
          continue; //try again with a different fetcher, I guess?
        }
        //shim the result
        const shimmedCompilations = Codec.Compilations.Utils.shimCompilations(
          compilations,
          `externalFor(${address})Via(${fetcher.fetcherName})`
        );
        //add it!
        await this.bugger.addExternalCompilations(shimmedCompilations);
        failure = false; //mark as *not* failed in case a previous fetcher failed
        //check: did this actually help?
        debug("checking result");
        if (!getUnknownAddresses(this.bugger).includes(address)) {
          debug(
            "address %s successfully recognized via %s",
            address,
            fetcher.fetcherName
          );
          found = true;
          //break out of the fetcher loop -- we got what we want
          break;
        }
        debug("address %s still unrecognized", address);
      }
      if (found === false) {
        //if we couldn't find it, add it to the list of addresses to skip
        addressesToSkip.add(address);
        //if we couldn't find it *and* there was a network or compile problem,
        //add it to the failures list
        if (failure === true) {
          switch (failureReason) {
            case "fetch":
              badAddresses.push(address);
              break;
            case "compile":
              badCompilationAddresses.push(address);
              break;
          }
        }
      }
    }
    return {
      badAddresses,
      badFetchers,
      badCompilationAddresses
    }; //main result is that we've mutated bugger,
    //not the return value!
  }
}

function getUnknownAddresses(bugger) {
  debug("getting unknown addresses");
  const instances = bugger.view(
    bugger.selectors.session.info.affectedInstances
  );
  debug("got instances");
  return Object.entries(instances)
    .filter(([_, {contractName}]) => contractName === undefined)
    .map(([address, _]) => address);
}

function getAnUnknownAddress(bugger, addressesToSkip) {
  return getUnknownAddresses(bugger).find(
    address => !addressesToSkip.has(address)
  );
}

module.exports = {
  DebugExternalHandler
};
