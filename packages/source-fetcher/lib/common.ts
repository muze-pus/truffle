//these imports aren't actually necessary, but why not :)
import util from "util";
import {setTimeout} from "timers";
import * as Types from "./types";

export const networksById: {[id: number]: string} = {
  1: "mainnet",
  3: "ropsten",
  4: "rinkeby",
  5: "goerli",
  42: "kovan"
};

export function makeFilename(name: string, extension: string = ".sol"): string {
  if (!name) {
    return "Contract" + extension;
  }
  if (name.endsWith(extension)) {
    return name;
  } else {
    return name + extension;
  }
}

export const makeTimer: (
  milliseconds: number
) => Promise<void> = util.promisify(setTimeout);

export function removeLibraries(
  settings: Types.SolcSettings
): Types.SolcSettings {
  let copySettings: Types.SolcSettings = {...settings};
  delete copySettings.libraries;
  return copySettings;
}

export class InvalidNetworkError extends Error {
  public networkId: number;
  public fetcherName: string;
  constructor(networkId: number, fetcherName: string) {
    super(`Invalid network ID ${networkId} for fetcher ${fetcherName}`);
    this.networkId = networkId;
    this.fetcherName = fetcherName;
    this.name = "InvalidNetworkError";
  }
}
