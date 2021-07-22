import debugModule from "debug";
const debug = debugModule("fetch-and-compile:fetch");
import semver from "semver";
import Fetchers from "@truffle/source-fetcher";
import {
  InvalidNetworkError,
  FetcherConstructor,
  SourceInfo
} from "@truffle/source-fetcher";
import type Config from "@truffle/config";
const { Compile } = require("@truffle/compile-solidity"); //sorry for untyped import!
import type { Recognizer, FailureType } from "./types";
import type { WorkflowCompileResult } from "@truffle/compile-common";

export async function fetchWithRecognizer(
  recognizer: Recognizer,
  config: Config
): Promise<void> {
  const userFetcherNames: string[] | undefined = config.sourceFetchers;
  //sort/filter fetchers by user's order, if given; otherwise use default order
  let sortedFetchers: FetcherConstructor[] = [];
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
  const networkId: number = config.network_id;
  //make fetcher instances. we'll filter out ones that don't support this
  //network (and note ones that yielded errors)
  debug("Fetchers: %o", Fetchers);
  const fetchers = (
    await Promise.all(
      Fetchers.map(async Fetcher => {
        try {
          return await Fetcher.forNetworkId(
            networkId,
            config[Fetcher.fetcherName]
          );
        } catch (error) {
          if (!(error instanceof InvalidNetworkError)) {
            //if it's *not* just an invalid network, log the error.
            recognizer.markBadFetcher(Fetcher.fetcherName);
          }
          //either way, filter this fetcher out
          return null;
        }
      })
    )
  ).filter(fetcher => fetcher !== null);
  //now: the main loop!
  let address: string;
  while ((address = recognizer.getAnUnrecognizedAddress()) !== undefined) {
    let found: boolean = false;
    let failureReason: FailureType | undefined; //undefined if no failure
    //(not set if there is no source)
    for (const fetcher of fetchers) {
      //now comes all the hard parts!
      //get our sources
      let result: SourceInfo | null;
      try {
        debug("getting sources for %s via %s", address, fetcher.fetcherName);
        result = await fetcher.fetchSourcesForAddress(address);
      } catch (error) {
        debug("error in getting sources! %o", error);
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
      const { sources, options } = result;
      if (options.language === "Vyper") {
        //if it's not Solidity, bail out now
        debug("found Vyper, bailing out!");
        recognizer.markUnrecognizable(address);
        //break out of the fetcher loop, since *no* fetcher will work here
        break;
      }
      //set up the config
      let externalConfig: Config = config.with({
        compilers: {
          solc: options
        }
      });
      //if using docker, transform it (this does nothing if not using docker)
      externalConfig = transformIfUsingDocker(externalConfig, config);
      //compile the sources
      let compileResult: WorkflowCompileResult;
      try {
        compileResult = await Compile.sources({
          options: externalConfig,
          sources
        });
      } catch (error) {
        debug("compile error: %O", error);
        failureReason = "compile";
        continue; //try again with a different fetcher, I guess?
      }
      //add it!
      await recognizer.addCompiledInfo(
        compileResult,
        result,
        address,
        fetcher.fetcherName
      );
      failureReason = undefined; //mark as *not* failed in case a previous fetcher failed
      //check: did this actually help?
      debug("checking result");
      if (!recognizer.getUnrecognizedAddresses().includes(address)) {
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
      recognizer.markUnrecognizable(address, failureReason);
    }
  }
}

function transformIfUsingDocker(
  externalConfig: Config,
  projectConfig: Config
): Config {
  const useDocker = Boolean(
    ((projectConfig.compilers || {}).solc || {}).docker
  );
  if (!useDocker) {
    //if they're not using docker, no need to transform anything :)
    return externalConfig;
  }
  const givenVersion: string = externalConfig.compilers.solc.version;
  //if they are, we have to ask: are they using a nightly?
  if (semver.prerelease(givenVersion)) {
    //we're not going to attempt to make Docker work with nightlies.
    //just keep Docker turned off.
    return externalConfig;
  }
  //otherwise, turn on Docker, and reduce the version to its simple form.
  const simpleVersion: string = semver.valid(givenVersion);
  return externalConfig.merge({
    compilers: {
      solc: {
        version: simpleVersion,
        docker: true
      }
    }
  });
}
