import debugModule from "debug";
const debug = debugModule("source-fetcher:etherscan");
// untyped import since no @types/web3-utils exists
const Web3Utils = require("web3-utils");

import type { Fetcher, FetcherConstructor } from "./types";
import type * as Types from "./types";
import {
  makeFilename,
  makeTimer,
  removeLibraries,
  InvalidNetworkError
} from "./common";
import { networkNamesById, networksByName } from "./networks";
import axios from "axios";
import retry from "async-retry";

const etherscanCommentHeader = `/**
 *Submitted for verification at Etherscan.io on 20XX-XX-XX
*/

`; //note we include that final newline

//this looks awkward but the TS docs actually suggest this :P
const EtherscanFetcher: FetcherConstructor = class EtherscanFetcher
  implements Fetcher
{
  static get fetcherName(): string {
    return "etherscan";
  }
  get fetcherName(): string {
    return EtherscanFetcher.fetcherName;
  }

  static async forNetworkId(
    id: number,
    options?: Types.FetcherOptions
  ): Promise<EtherscanFetcher> {
    debug("options: %O", options);
    debug("id:", id);
    return new EtherscanFetcher(id, options ? options.apiKey : "");
  }

  private readonly networkName: string;

  private readonly apiKey: string;
  private readonly delay: number; //minimum # of ms to wait between requests

  private ready: Promise<void>; //always await this timer before making a request.
  //then, afterwards, start a new timer.

  private static readonly supportedNetworks = new Set([
    "mainnet",
    "ropsten",
    "kovan",
    "rinkeby",
    "goerli",
    "optimistic",
    "kovan-optimistic",
    "arbitrum",
    "rinkeby-arbitrum",
    "polygon",
    "mumbai-polygon",
    "binance",
    "testnet-binance",
    "fantom",
    "testnet-fantom",
    //we don't support avalanche, even though etherscan has snowtrace.io
    "heco",
    "testnet-heco",
    "moonbeam",
    "moonriver",
    "moonbase-alpha"
  ]);

  constructor(networkId: number, apiKey: string = "") {
    const networkName = networkNamesById[networkId];
    if (
      networkName === undefined ||
      !EtherscanFetcher.supportedNetworks.has(networkName)
    ) {
      throw new InvalidNetworkError(networkId, "etherscan");
    }
    this.networkName = networkName;
    debug("apiKey: %s", apiKey);
    this.apiKey = apiKey;
    const baseDelay = this.apiKey ? 200 : 3000; //etherscan permits 5 requests/sec w/a key, 1/3sec w/o
    const safetyFactor = 1; //no safety factor atm
    this.delay = baseDelay * safetyFactor;
    this.ready = makeTimer(0); //at start, it's ready to go immediately
  }

  static getSupportedNetworks(): Types.SupportedNetworks {
    return Object.fromEntries(
      Object.entries(networksByName).filter(([name, _]) =>
        EtherscanFetcher.supportedNetworks.has(name)
      )
    );
  }

  async fetchSourcesForAddress(
    address: string
  ): Promise<Types.SourceInfo | null> {
    const response = await this.getSuccessfulResponse(address);
    return EtherscanFetcher.processResult(response.result[0]);
  }

  private async getSuccessfulResponse(
    address: string
  ): Promise<EtherscanSuccess> {
    const initialTimeoutFactor = 1.5; //I guess?
    return await retry(async () => await this.makeRequest(address), {
      retries: 3,
      minTimeout: this.delay * initialTimeoutFactor
    });
  }

  private determineUrl() {
    const scanners: { [network: string]: string } = {
      //etherscan.io is treated separately
      polygon: "polygonscan.com",
      arbitrum: "arbiscan.io",
      binance: "bscscan.com",
      fantom: "ftmscan.com",
      //we don't support avalanche's snowtrace.io
      heco: "hecoinfo.com"
      //moonscan.io is treated separately
    };
    const [part1, part2] = this.networkName.split("-");
    if (part2 === undefined && this.networkName in scanners) {
      //mainnet for one of the above scanners
      return `https://api.${scanners[this.networkName]}/api`;
    } else if (part2 in scanners) {
      //a testnet for one of the above scanners;
      //part1 is the testnet name, part2 is the broader mainnet name
      let [testnet, network] = [part1, part2];
      if (network === "arbitrum" && testnet === "rinkeby") {
        //special case: arbitrum rinkeby is testnet.arbiscan.io,
        //not rinkeby.arbiscan.io
        //note: if we supported avalanche, it would have a similar special case
        testnet = "testnet";
      }
      return `https://api-${testnet}.${scanners[network]}/api`;
    } else if (part1.startsWith("moon")) {
      //one of the moonbeam networks; here even the moonbeam mainnet
      //gets a prefix (we use part1 to get moonbase, not moonbase-alpha)
      const shortName = part1;
      return `https://api-${shortName}.moonscan.io/api`;
    } else if (this.networkName === "mainnet") {
      //ethereum mainnet
      return "https://api.etherscan.io/api";
    } else {
      //default case: an ethereum testnet, or an optimistic network (main or test)
      return `https://api-${this.networkName}.etherscan.io/api`;
    }
  }

  private async makeRequest(address: string): Promise<EtherscanSuccess> {
    //not putting a try/catch around this; if it throws, we throw
    await this.ready;
    const responsePromise = axios.get(this.determineUrl(), {
      params: {
        module: "contract",
        action: "getsourcecode",
        address,
        apikey: this.apiKey
      },
      responseType: "json",
      maxRedirects: 50
    });
    this.ready = makeTimer(this.delay);
    const response: EtherscanResponse = (await responsePromise).data;
    if (response.status === "0") {
      throw new Error(response.result);
    }
    return response;
  }

  private static processResult(
    result: EtherscanResult
  ): Types.SourceInfo | null {
    //we have 5 cases here.
    //case 1: the address doesn't exist
    if (
      result.SourceCode === "" &&
      result.ABI === "Contract source code not verified"
    ) {
      return null;
    }
    //case 2: it's a Vyper contract
    if (result.CompilerVersion.startsWith("vyper:")) {
      return this.processVyperResult(result);
    }
    let multifileJson: Types.SolcSources;
    try {
      //try to parse the source JSON.  if it succeeds,
      //we're in the multi-file case.
      multifileJson = JSON.parse(result.SourceCode);
    } catch (_) {
      //otherwise, we could be single-file or we could be full JSON.
      //for full JSON input, etherscan will stick an extra pair of braces around it
      if (
        result.SourceCode.startsWith("{") &&
        result.SourceCode.endsWith("}")
      ) {
        const trimmedSource = result.SourceCode.slice(1).slice(0, -1); //remove braces
        let fullJson: Types.SolcInput;
        try {
          fullJson = JSON.parse(trimmedSource);
        } catch (_) {
          //if it still doesn't parse, it's single-source I guess?
          //(note: we shouldn't really end up here?)
          debug("single-file input??");
          return this.processSingleResult(result);
        }
        //case 5: full JSON input
        debug("json input");
        return this.processJsonResult(result, fullJson);
      }
      //case 3 (the way it should happen): single source
      debug("single-file input");
      return this.processSingleResult(result);
    }
    //case 4: multiple sources
    debug("multi-file input");
    return this.processMultiResult(result, multifileJson);
  }

  private static processSingleResult(
    result: EtherscanResult
  ): Types.SourceInfo {
    const filename = makeFilename(result.ContractName);
    return {
      contractName: result.ContractName,
      sources: {
        //we prepend this header comment so that line numbers in the debugger
        //will match up with what's displayed on the website; note that other
        //cases don't display a similar header on the website
        [filename]: etherscanCommentHeader + result.SourceCode
      },
      options: {
        language: "Solidity",
        version: result.CompilerVersion,
        settings: this.extractSettings(result),
        specializations: {
          libraries: this.processLibraries(result.Library),
          constructorArguments: result.ConstructorArguments
        }
      }
    };
  }

  private static processMultiResult(
    result: EtherscanResult,
    sources: Types.SolcSources
  ): Types.SourceInfo {
    return {
      contractName: result.ContractName,
      sources: this.processSources(sources),
      options: {
        language: "Solidity",
        version: result.CompilerVersion,
        settings: this.extractSettings(result),
        specializations: {
          libraries: this.processLibraries(result.Library),
          constructorArguments: result.ConstructorArguments
        }
      }
    };
  }

  private static processJsonResult(
    result: EtherscanResult,
    jsonInput: Types.SolcInput
  ): Types.SourceInfo {
    return {
      contractName: result.ContractName,
      sources: this.processSources(jsonInput.sources),
      options: {
        language: jsonInput.language,
        version: result.CompilerVersion,
        settings: removeLibraries(jsonInput.settings), //we *don't* want to pass library info!  unlinked bytecode is better!
        specializations: {
          libraries: jsonInput.settings.libraries,
          constructorArguments: result.ConstructorArguments
        }
      }
    };
  }

  private static processVyperResult(result: EtherscanResult): Types.SourceInfo {
    const filename = makeFilename(result.ContractName, ".vy");
    //note: this means filename will always be Vyper_contract.vy
    return {
      sources: {
        [filename]: result.SourceCode
      },
      options: {
        language: "Vyper",
        version: result.CompilerVersion.replace(/^vyper:/, ""),
        settings: this.extractVyperSettings(result),
        specializations: {
          constructorArguments: result.ConstructorArguments
        }
      }
    };
  }

  private static processSources(
    sources: Types.SolcSources
  ): Types.SourcesByPath {
    return Object.assign(
      {},
      ...Object.entries(sources).map(([path, { content: source }]) => ({
        [makeFilename(path)]: source
      }))
    );
  }

  private static extractSettings(result: EtherscanResult): Types.SolcSettings {
    const evmVersion: string =
      result.EVMVersion === "Default" ? undefined : result.EVMVersion;
    const optimizer = {
      enabled: result.OptimizationUsed === "1",
      runs: parseInt(result.Runs)
    };
    //old version got libraries here, but we don't actually want that!
    if (evmVersion !== undefined) {
      return {
        optimizer,
        evmVersion
      };
    } else {
      return {
        optimizer
      };
    }
  }

  private static processLibraries(
    librariesString: string
  ): Types.LibrarySettings {
    let libraries: Types.Libraries;
    if (librariesString === "") {
      libraries = {};
    } else {
      libraries = Object.assign(
        {},
        ...librariesString.split(";").map(pair => {
          const [name, address] = pair.split(":");
          return { [name]: Web3Utils.toChecksumAddress(address) };
        })
      );
    }
    return { "": libraries }; //empty string as key means it applies to all contracts
  }

  private static extractVyperSettings(
    result: EtherscanResult
  ): Types.VyperSettings {
    const evmVersion: string =
      result.EVMVersion === "Default" ? undefined : result.EVMVersion;
    //the optimize flag is not currently supported by etherscan;
    //any Vyper contract currently verified on etherscan necessarily has
    //optimize flag left unspecified (and therefore effectively true).
    //do NOT look at OptimizationUsed for Vyper contracts; it will always
    //be "0" even though in fact optimization *was* used.  just leave
    //the optimize flag unspecified.
    if (evmVersion !== undefined) {
      return { evmVersion };
    } else {
      return {};
    }
  }
};

type EtherscanResponse = EtherscanSuccess | EtherscanFailure;

interface EtherscanSuccess {
  status: "1";
  message: string;
  result: EtherscanResult[];
}

interface EtherscanFailure {
  status: "0";
  message: string;
  result: string;
}

//apologies for this being stringly-typed, but that's how
//Etherscan does it
interface EtherscanResult {
  SourceCode: string; //really: string | SolcSources | SolcInput
  ABI: string; //really: it's the ABI [we won't use this]
  ContractName: string;
  CompilerVersion: string;
  OptimizationUsed: string; //really: a number used as a boolean
  Runs: string; //really: a number
  ConstructorArguments: string; //encoded as hex string, no 0x in front
  EVMVersion: string;
  Library: string; //semicolon-delimited list of colon-delimited name-address pairs (addresses lack 0x in front)
  LicenseType: string; //ignored
  Proxy: string; //no clue what this is [ignored]
  Implementation: string; //or this [ignored]
  SwarmSource: string; //ignored
}

export default EtherscanFetcher;
