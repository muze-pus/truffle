import BN from "bn.js";
import Web3 from "web3";
import { Conversion as ConversionUtils } from "./conversion";

export namespace EVM {
  export const WORD_SIZE = 0x20;
  export const MAX_WORD = new BN(2).pow(new BN(256)).subn(1);

  export function keccak256(...args: any[]): BN {
    const web3 = new Web3();

    // debug("args %o", args);

    const sha: string = web3.utils.soliditySha3(...args).replace(/0x/, "");
    // debug("sha %o", sha);
    return ConversionUtils.toBN(sha);
  }
}